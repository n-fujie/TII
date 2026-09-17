# Controlled issuance rehearsal (2026-09-17)

A live, end-to-end rehearsal of the complete issuance path, using the real
production code paths (CLI, `src/ledger.js`, `src/export.js`, a real
`src/server.js` process, the actual built static site) against an
isolated temporary ledger — never `data/ledger.jsonl`, never with
production issuance enabled. Every command below actually ran; this is a
report of what happened, not a description of what should happen.

## State transitions

| # | Action | Real command | Result |
|---|---|---|---|
| 1 | Issue | `node bin/tii.js issue --recorder ... --idempotency-key REHEARSAL-K1` | `tii:c2t4chcqrfnz` persisted, `seq: 0`, chain head `154fd745...` |
| 2 | Verify | `node bin/tii.js verify` | `VALID`, `event_count: 1` |
| 3 | **Interruption point** | — | Ledger durable; zero derived artifacts exist. This is the natural state between "issued" and "ever rebuilt" — not manufactured, just observed before running step 4. |
| 4 | Recover | `node bin/tii.js rebuild-static <dir>` | Full static tree materialized: `catalog.json`, per-identifier `.html`/`.json` (both languages), registry/audit/spec/about pages, ledger exports — from the ledger alone |
| 5 | Dynamic resolver | real `src/server.js` process, port 38217 | `/tii/tii_c2t4chcqrfnz` → 200; `/resolve?tii=tii:c2t4chcqrfnz` → 302 → same page; `/resolve?tii=tii:c2t4chcqrfnz%23note` → **same** 302 target; unknown token → 404; `/catalog.json` matches the static one exactly |
| 6 | Static resolver | the actual shipped `<script>` from the built `index.html`, executed via `vm` | Fragment-bearing input `tii:c2t4chcqrfnz#rehearsal-note` → resolves to `/tii/tii_c2t4chcqrfnz`, identical to the dynamic server |
| 7 | CLI lookup | `tii show`/`tii events` with a fragment-bearing reference | Both resolve correctly, identical to the resolver paths |
| 8 | Idempotent retry | `tii issue` again, same key + same content | Returned the identical original event; ledger stayed at 1 line |
| 9 | **Conflict retry — found a defect** | `tii issue` again, same key + **different** content | See "Finding" below |
| 10 | Destruction | `rm -rf <site dir>` | Only `data/ledger.jsonl` remained anywhere |
| 11 | Reconstruction | `node bin/tii.js rebuild-static <dir>` (dir didn't exist) | Identical `catalog.json` content (same head hash, same identifier data — only the wall-clock `generated_at` differed) |
| 12 | Dynamic reconstruction | restart `src/server.js` against the same ledger | 200 immediately — no rebuild step exists for the dynamic path at all; it reads the ledger directly on every request |

## Finding: `issueTII()`'s idempotency check didn't compare content

Step 9 above did not fail closed as it should have. `Ledger.issueTII()`
had its own idempotency pre-check (separate from `_validateAppend()`'s,
which is correct) that verified only `event_type === 'tii.issued'` —
never `content`. A caller reusing a key with genuinely different content
silently received the *original* request's result with no error,
instead of the fail-closed conflict every other idempotency check in
this codebase implements — including `issueProductionTII()`, corrected
for this exact class of bug in the immediately preceding session phase
(`spec/production-launch-gate.md`'s "G6/G14 idempotency repair"). This
was the same defect, on the general path, undiscovered until this
rehearsal actually ran the CLI end-to-end rather than reasoning about it.

**Fixed** (`src/ledger.js` `issueTII()`): the pre-check now compares
canonicalized content too, mirroring `_validateAppend()`'s existing
comparison exactly. Re-ran the exact failing rehearsal step afterward —
now correctly rejects with `idempotency_key "REHEARSAL-K1" was already
used for a different operation`, exit code 1, ledger untouched.

Three new regression tests added
(`test/issuance-path-audit.test.js`): same-key/same-content still
replays; same-key/different-content now fails closed; and a parity test
proving `issueTII()`'s pre-check and `append()`'s own
`_validateAppend()` agree exactly, guarding against the two drifting
apart again. Full suite re-run clean (242/242) both before removing the
old behavior's last dependent and after — nothing else in the codebase
relied on the incorrect behavior.

## Recovery invariants confirmed

- **The ledger is sufficient.** Every derived artifact — static site,
  catalog, per-identifier pages, dynamic resolution — was reconstructed
  from `data/ledger.jsonl` alone, with no other input.
- **Reconstruction is idempotent in outcome.** Rebuilding twice from the
  same ledger state produces identical content (only the build
  timestamp differs) — confirmed both by this rehearsal and by the
  existing atomic-rebuild regression suite
  (`spec/issuance-path-audit-2026-09-19.md`).
- **The dynamic resolver has no separate derived state to lose.** It
  reads the ledger on every request; "recovery" for it is just
  restarting the process against the same file — proven, not assumed.
- **Fragment-bearing references resolve identically everywhere** — CLI,
  dynamic resolver, and the actual static build's own shipped script —
  because all three now share one primitive (`src/tii-lookup.js`,
  extracted in the prior session phase).
- **An interrupted rebuild cannot corrupt the live site** — proven
  separately and in depth in `spec/issuance-path-audit-2026-09-19.md`;
  not re-rehearsed live here since it is a destructive-timing scenario
  better exercised by the deterministic regression tests than by a
  live process kill.

## Residual operational risk

- The two-rename swap in `buildStaticSite()` (documented in
  `spec/issuance-path-audit-2026-09-19.md`) still has a narrow,
  sub-millisecond window where a *replaced* `outDir` is transiently
  absent if the process is killed exactly between the two renames. Not
  eliminated here; would require a directory-topology change
  (symlink-indirected release) judged out of scope. The old build is
  never lost in this window (recoverable from a `.stale-*` sibling), and
  the actual production deployment path is additionally protected by
  Vercel's own atomic-per-deployment model.
- `issueTII()`/`append()` remain deliberately non-idempotent when no
  `idempotency_key` is supplied — by design, documented, and now
  explicitly demonstrated (`test/issuance-path-audit.test.js`'s
  "NON-IDEMPOTENT BY DESIGN" test). Callers needing retry-safety must
  supply a key; the ledger does not infer one.
- A hard process kill (not a thrown JS error) during `buildStaticSite()`
  skips its `catch` block's temp-directory cleanup, leaving an orphaned
  `<outDir>.building-*` directory on disk — a disk-hygiene concern only
  (never in `outDir`'s own served path), not a correctness risk.

## Scope discipline confirmed

Throughout this rehearsal: `data/ledger.jsonl` byte-identical before and
after (10 events, SHA-256
`6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`);
`src/identifier.js`, `src/id.js`, `src/production-gate.js`, and
`src/production-issuance.js` untouched — no identifier-syntax,
token-format, or canonical-form change; the real repository's production
gate confirmed closed (`computeGateStatus(...).available === false`)
both before and after; no production TII issued or considered. The only
code change is the idempotency-content-comparison fix in
`src/ledger.js` `issueTII()` — a correctness fix to an existing,
already-documented contract, not a new one.
