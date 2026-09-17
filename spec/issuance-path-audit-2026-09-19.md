# Full TII issuance path audit (2026-09-19)

End-to-end trace of the complete issuance path — generation, collision
checking, ledger persistence, registry/catalog generation, resolver
visibility, failure recovery — treating `data/ledger.jsonl` as the sole
record of authority. Production issuance was not enabled anywhere in this
audit; every test runs against disposable ledgers/build directories.

## 1. The path, traced

```
generation          src/id.js newTII() (test)  /  src/identifier.js generateIdentifier() (production, gated closed)
     |
collision check      candidate vs. ledger.tiiExists() -- optimistic (pre-lock) then authoritative (post-lock, post-resync)
     |
ledger persistence   src/ledger.js Ledger.append(): journal write+fsync -> canonical write+fsync -> journal unlink
     |
[production only]    src/checkpoint-store.js createCheckpoint() -- signs the new head; failure blocks further mutation, never rolls back
     |
registry/catalog     src/export.js buildStaticSite() -- reads ledger.listTIIs(), writes catalog.json + per-identifier pages
     |
resolver visibility  src/server.js (dynamic) or the built static tree (deployed) -- src/tii-lookup.js resolves references to these pages
     |
failure recovery     src/recovery.js `tii recover inspect/truncate-tail/commit-journal/discard-journal`
```

## 2. What was already correct and thoroughly proven

- **Ledger append is crash-safe at every write boundary** — write-ahead
  journal (fsynced) before the canonical append (also fsynced), journal
  removed only after the canonical write is durable. A crash between any
  two of these steps is detected and reported, never silently
  misinterpreted, never causes data loss or duplication
  (`test/crash-recovery.test.js`, unchanged, still passing).
- **Single-authoritative-writer model** — a cross-process advisory lock
  (`src/writer-lock.js`) plus an authoritative resync-and-revalidate
  inside the lock means a losing concurrent writer is always detected
  before it could corrupt anything, and a stale lock from a dead process
  is safely reclaimed (`test/writer-lock.test.js`, unchanged).
- **Production issuance's collision handling** (`src/production-issuance.js`)
  already discards a collided candidate inside the writer lock and
  retries, proven under real multi-process concurrency
  (`test/production-gate.test.js` §10, unchanged).
- **Production issuance's idempotency contract** was found broken and
  fixed in the immediately preceding session phase
  (`spec/production-launch-gate.md`'s "G6/G14 idempotency repair") —
  restart-safe, concurrency-safe, conflict-detecting. Not re-litigated
  here; carried forward as already correct.

## 3. What this audit found and fixed

### 3.1 `Ledger.issueTII()`'s collision retry had never been proven at the ledger level

The generator's own retry loop (`src/id.js` `newTII`) was tested directly
(`test/id-syntax.test.js`). Production issuance's collision handling was
tested at the ledger level (`test/production-gate.test.js` §10). But
`ledger.issueTII()` — the general TEST-issuance path, which is the only
path anything in this repository's committed configuration actually
exercises — had no test proving its own call into `newTII()` correctly
discards a real, ledger-recorded collision and retries. Not a defect (the
code path is a one-line integration of two already-correct pieces), but
an unproven one.

**Added**: a test that fakes the underlying CSPRNG byte source
(`crypto.randomBytes`, a property access in `src/id.js` — not
destructured, so a real interception, unlike attempting to patch
`src/id.js`'s exports, which `src/ledger.js` destructures at
require-time and could not observe) to force the *first* candidate draw
to collide with a real, pre-recorded ledger entry, and the retry draw to
be fresh. This exercises the real, unmodified `newTII()`/`randomBody()`
retry loop end-to-end, not a re-implementation of it.

### 3.2 Concurrent fresh issuance (general path) had no real multi-process proof

`test/writer-lock.test.js`'s existing concurrency test uses concurrent
`append()` calls against an *already-issued* TII (`note.added` events).
Concurrent *fresh* `issueTII()` calls — the actual "N users show up at
once and each want a new identifier" scenario — had no test at the
general-path level (only `issueProductionTII()`, the gated path, had
this).

**Added**: two tests spawning real OS processes — one where each
concurrently issues a distinct fresh identifier (no idempotency key: N
processes, N distinct results, zero corruption, zero collisions), one
where all share the same idempotency key (all converge on exactly one
canonical event, matching the already-fixed production-path contract,
now proven for the general path too).

### 3.3 Non-idempotent operations — identified and demonstrated, not silently assumed

**By design, unchanged**: `issueTII()`/`append()` called twice with no
`idempotency_key` genuinely double-records. This is documented existing
behavior (`spec/crash-recovery.md`, the pre-existing "§27 KNOWN
LIMITATION" test in `test/production-gate.test.js`) — callers that need
retry-safety must supply a key. This audit adds one explicit test stating
this plainly at the general-issuance level, so it is demonstrated, not
merely asserted in a comment.

### 3.4 Registry/catalog generation was NOT atomic — the most significant finding

`src/export.js` `buildStaticSite()` used to:
1. `fs.rmSync(outDir, { recursive: true, force: true })` — **destroy the
   live output directory immediately**, then
2. write every file (ledger copies, per-identifier pages, home/registry/
   audit pages, `catalog.json`) directly into `outDir`, one at a time.

**Any interruption between steps 1 and the final write** — a process
kill, an uncaught exception partway through, the host losing power —
left `outDir` in a partially-written, inconsistent state, for however
long it took someone to notice and rebuild again:
- Missing per-identifier pages while `catalog.json` still listed them (or
  vice versa) — exactly the registry/resolver visibility mismatch this
  task asked to look for.
- In the worst case (killed immediately after step 1), the entire public
  site — every page, catalog.json, the exported ledger copies — simply
  gone.
- For the actually-deployed production site, Vercel's own atomic-per-
  deployment model happens to protect against this in practice (a failed
  build is never promoted), but `rebuild-static` is also invokable
  directly (CLI, and `GET /export/static` on the dynamic server) outside
  that protection, and nothing in this codebase's own logic prevented the
  inconsistency.

**Fixed**: `buildStaticSite()` now builds the entire tree into a private,
unique-per-invocation temporary directory next to `outDir` (same volume,
so the final step is a real rename, not a copy) and only replaces
`outDir` via `fs.renameSync` once every file has been written
successfully. On any failure before the swap, the temp directory is
removed and `outDir` is never touched — the old build (if any) stays
exactly as it was.

**Remaining failure mode, documented, not eliminated**: replacing an
*existing* `outDir` requires two renames (move the old build aside, move
the new build in) because POSIX `rename()` cannot atomically swap two
existing directories in one syscall. A crash exactly between these two
renames leaves `outDir` transiently absent (though the old build is
still fully intact under a `.stale-*` sibling, never lost) until the next
rebuild. This shrinks the inconsistent-state window from "however long a
full rebuild takes" (seconds, growing with registry size) to "a single
directory-rename syscall" (sub-millisecond) and — critically — changes
the failure mode from *silently serving a broken, half-written site* to
*a very brief, self-evident absence, with the previous good build
trivially recoverable on disk*. Fully eliminating even that narrow window
would require changing the deployment's directory topology (a
symlink-indirection release scheme, `current -> release-<n>`, atomically
repointed) — out of scope here as a topology change, and unnecessary
given Vercel's own atomic-deployment guarantee already covers the actual
production path.

Also documented, not fixed (low severity, disk hygiene only): a build
that fails via a genuine unrecoverable process kill (not a caught
exception) skips the temp-directory cleanup in the `catch` block, leaving
an orphaned `<outDir>.building-*` directory on disk. It is never in
`outDir`'s own path and can never be accidentally served, but an operator
running `rebuild-static` repeatedly under repeated hard failures should
periodically clean up `<outDir>.building-*`/`<outDir>.stale-*` siblings.

## 4. Regression tests added

`test/issuance-path-audit.test.js` (8 tests): the ledger-level collision
proof (3.1), both concurrency proofs (3.2), the documented
non-idempotent-without-a-key demonstration (3.3), three rebuild-atomicity
tests (interrupted mid-build leaves `outDir` untouched; interrupted
exactly during the swap leaves the old build recoverable via `.stale-*`
and a subsequent rebuild still succeeds; the first-ever build is a single
atomic rename with zero leftover artifacts), and one registry↔resolver
consistency check (catalog.json's identifier list exactly matches the
per-identifier files actually on disk after a clean build).

## 5. Result

Full test suite: 239/239 passing (231 prior + 8 new), re-run multiple
times for confidence, zero flakiness in the new concurrency/adversarial
tests. Canonical ledger byte-identical throughout (10 events, SHA-256
`6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`).
`src/identifier.js`, `src/id.js`, `src/ledger.js`,
`src/production-gate.js`, and `src/production-issuance.js` were not
modified — no change to identifier syntax, token format, canonical form,
or the ledger's own append/validation logic. The real repository's
production gate remains closed (`computeGateStatus(...).available ===
false`). The only code change is `src/export.js` `buildStaticSite()`'s
atomicity fix, which changes *when* files become visible (all-at-once
instead of one-at-a-time) without changing *what* gets built.
