# TII Production-Hardening Phase 1 — Adversarial Verification

**Date:** 2026-09-11. **System under test:** commit `4ce2d80` ("Production-hardening
Phase 1: signed checkpoints, admin fail-closed, single-writer safety").
**Scope:** attempt to break the Phase 1 hardening claims. No new product
features, no architecture redesign, no production issuance, no identifier
syntax change, no domain purchase, no IANA submission. Every test ran
against disposable copies under `os.tmpdir()`; the committed canonical
ledger (`data/ledger.jsonl`) was never touched.

**Bottom line:** two real, exploitable defects were found and fixed (both
narrow, in-scope repairs to Phase 1's own new code — not architecture
changes). Several more defects and limitations were found, reproduced, and
are documented here **without being fixed**, because fixing them would mean
changing a design decision (e.g. checkpoint-selection policy, a trusted
timestamp authority) rather than repairing a bug — exactly the kind of
scope creep this task instructs against. Phase 1's core safety claims — the
two-claims separation, fail-closed admin, single-writer correctness under
real concurrency, crash-safe append, and idempotent retries — **held up**
under adversarial testing once the two defects below were closed. The
system is not stronger than Phase 1 claimed; if anything, this exercise
narrows several claims further (see §1's three-property classification and
§4).

---

## Defects found and FIXED in this task

### D1 — Symlink escape defeats `/admin/hash-file`'s safe-directory confinement (§13)

- **Severity:** HIGH (authenticated arbitrary file read — requires the admin
  token, but completely defeats the specific safety property Phase 1 P0-B
  claimed for this endpoint).
- **Reproduction:** inside the configured `TII_ADMIN_HASH_DIR`, create a
  symlink pointing outside it (`ln -s /path/outside/secret.txt
  safe-dir/link.txt`), then `POST /admin/hash-file` with `path=link.txt`
  and a valid token. **Before the fix: HTTP 200, the file outside the safe
  directory was hashed and its filename echoed back.** Confirmed for a
  direct symlink, a nested symlink chain, and a symlinked directory
  (`link.txt` → outside file; `link.txt` → `link.txt`; `escape-dir/` →
  outside directory).
- **Root cause:** `resolveSafeHashPath()` (`src/server.js`) validated the
  path with `path.resolve()` plus a string-prefix check only — purely
  lexical. It never resolved symlinks, so a symlink whose *name* lives
  inside the safe directory but whose *target* does not was accepted: the
  check inspected the spelling of the path, not where it actually points.
- **Fix applied:** `resolveSafeHashPath()` now also resolves the candidate
  path with `fs.realpathSync()` (following every symlink in the chain) and
  re-checks the prefix against a `fs.realpathSync()`-resolved
  `ADMIN_HASH_DIR`, computed once at startup. The realpath'd result — not a
  path re-derived from the caller's string — is what gets hashed, keeping
  the gap between validation and read as small as the syscalls allow.
- **Residual limitation (documented, not fixed):** Node's `fs` API has no
  portable "resolve and open, confined, in one atomic step" primitive (no
  `O_NOFOLLOW`-and-confine helper cross-platform). A symlink swapped into
  place in the instant *between* `realpathSync()` and the subsequent read
  could theoretically still redirect it (TOCTOU). This window is now
  microseconds (two syscalls) rather than the previous permanent bypass,
  and requires local write access to the safe directory at the exact
  moment of an admin request — a materially smaller and harder-to-exploit
  condition than the one just closed. Not eliminated; documented.
- **Verification:** `test/admin-security.test.js` test M (permanent
  regression) — direct symlink, nested symlink, symlinked directory all now
  rejected with `400` before the fix's patch is reverted this test would
  fail. Full suite: 146/146 passing after the fix.

### D2 — `GET /checkpoint/verify?file=` was an unauthenticated file-existence oracle / arbitrary-path reader (§16, new finding)

- **Severity:** MEDIUM-HIGH. Unlike `/admin/hash-file`, this route requires
  **no token at all** — it is deliberately public (checkpoint verification
  is meant to be checkable by anyone). This is a defect **introduced by
  Phase 1 itself** (the route did not exist before this phase) and was not
  in the task's explicit P0-B scope, because it isn't the admin surface —
  it's a new gap in the new checkpoint feature.
- **Reproduction:** `GET /checkpoint/verify?file=/etc/some/path` (or any
  absolute/traversal path) was passed straight through to
  `checkpointStore.verifyCheckpoint()`, whose `file` option is a **trusted**
  parameter — the CLI legitimately uses it to verify an arbitrary,
  externally-retrieved checkpoint file (`spec/checkpoint-operation.md`).
  `verifyCheckpoint()` calls `fs.readFileSync(target.path, ...)` and
  reports the resulting error message verbatim. Before the fix: requesting
  a real, non-checkpoint file returned a "malformed checkpoint" JSON parse
  error; requesting a non-existent path returned a distinct `ENOENT`
  message — an unauthenticated **existence oracle** for arbitrary
  filesystem paths. It did not return raw file content unless the target
  happened to be valid checkpoint-shaped JSON.
- **Root cause:** the HTTP route forwarded an untrusted, public query
  parameter into an API designed for a trusted caller (the CLI), with no
  validation of its own.
- **Fix applied:** `src/server.js`'s `checkpoint/verify` handler now
  requires `file` to be a bare filename (`path.basename(f) === f`, not `.`
  or `..`) before it is passed to `verifyCheckpoint()`; anything else is
  rejected with `400` before any filesystem access. `checkpointStore`'s API
  itself (and the CLI's use of it) is untouched — the fix is entirely at
  the untrusted-input boundary, which is where it belongs.
- **Verification:** `test/admin-security.test.js` test N (permanent
  regression). Full suite: 146/146 passing.

---

## Defects and limitations found and DOCUMENTED, not fixed

Each of these was reproduced and recorded. None was fixed, because fixing
it would require a design/policy decision this task's own preamble forbids
("do not add new product features," "do not redesign the architecture") —
not because it wasn't real.

### L1 — "Latest checkpoint" selection trusts filename sort, not validity (§1 Scenario B, §16 state 7)

An attacker who can write into the checkpoint directory (but does **not**
have the signing key) can drop a file whose name sorts after all legitimate
checkpoints (`listCheckpoints()`/`latestCheckpoint()` sort by filename,
which embeds a zero-padded event count). If that file is well-formed JSON
with a broken/foreign signature, `verifyCheckpoint()` with no `--file`
correctly reports `INVALID` for *that* file — but does **not** fall back to
an older, genuinely valid checkpoint that still exists one file over. An
operator checking only the default (no `--file`) output could conclude
checkpointing is broken or compromised when it is not. (A checkpoint file
that fails to *parse* as JSON at all *is* correctly filtered out by
`latestCheckpoint()` and does correctly fall back — this only affects a
well-formed-but-invalidly-signed "latest" file.) **Not a forgery** — no
false `VERIFIED` was ever produced in any test — but a real availability /
auditability gap. **Not fixed**: a "pick the most recent *valid*
checkpoint" policy is a design decision (what counts as a legitimate
fallback, and whether that itself creates a new way to hide a *real*
compromise by making a genuine failure look transient) that belongs in a
future phase's explicit policy choice, not a silent repair here.

### L2 — Key compromise + backdated `created_at` cannot be distinguished from a genuine historical signature (§4)

Exactly the limitation the task anticipated. `verifySignedCheckpoint()`'s
revocation check trusts `checkpoint.created_at`, a field the checkpoint's
own (possibly compromised) key signs — the signature proves *what* was
signed, never *when* the signing operation actually happened. An attacker
holding a key stolen before its revocation can produce a checkpoint dated
arbitrarily before the revocation cutoff, for arbitrary (forged) content,
and it verifies identically to a genuine historical checkpoint. **Confirmed
empirically** (`item234.js` §4 in the working test log): a backdated,
forged checkpoint signed with a since-revoked key reported `status:
VERIFIED`. This requires an independent trusted timestamp (RFC 3161 TSA,
transparency log, or timely witness countersignature) that TII does not
implement. **Explicitly not fixed** — the task instructs not to invent a
trusted timestamp system in this task.

### L3 — No independent temporal anchoring; "external anchor" language must be used carefully (§1)

TII checkpoints currently prove **signed-head authenticity** (a specific
key attested to a specific head at a claimed time) but not **independent
temporal anchoring** (proof the attestation itself happened when claimed)
and not, by themselves, **external custody** — `checkpoints/` today lives
on the same host, under the same operator's control, as `ledger.jsonl`.
The forgery-detection property demonstrated in §1 Scenario A only holds if
a copy of the pre-forgery checkpoint was retained **somewhere the attacker
did not also compromise**. This system must not be described as having an
"external anchor" or "independent witness" until checkpoints are actually
published outside the operator's own infrastructure. Not a code defect —
a documentation/terminology discipline finding, now recorded normatively
(see §1 below and the capability-matrix update).

### L4 — Writes are permitted with no signing key configured, with no write-time warning (§3)

Confirmed: `issueTII()`/`append()` succeed with zero signing key configured
anywhere. Every event written during such a window is **uncheckpointed** —
if the ledger is later fully rewritten covering that window and no prior
checkpoint exists, the forgery is undetectable by anything this system has.
This is the *documented, accepted* Phase-1 policy (checkpointing is
best-effort and never blocks a mutation — see
`spec/checkpoint-operation.md` "Policy chosen"), not an oversight, but it
is worth restating plainly: the only way to observe this state today is
`GET /status` or the Audit page — nothing surfaces a warning at write time.
**Not fixed** — adding a write-time warning banner or blocking behavior
would be a policy change (and the task's own P0-A explicitly chose
"best-effort, never blocks a mutation").

### L5 — PID-reuse hazard in `isProcessAlive()`; no dedicated stale-lock recovery command (§5, §6)

`process.kill(pid, 0)` can only confirm *a* process with that PID exists,
not that it's the *same* process that acquired the lock. A long-lived host
could, in principle, recycle a PID between a writer's crash and the next
reclaim attempt, making a truly-dead writer look alive indefinitely (no
lock-age heuristic exists to catch this, by design — see §5). Separately,
none of the `tii recover *` subcommands target a suspected-stale writer
*lock* specifically (they all operate on the journal/tail) — an operator
facing this narrow case would need to inspect and remove `<ledger>.lock`
manually. **Not fixed** — the lock format already carries `pid`, `host`,
and `acquired_at`; adding a random nonce or a dedicated `tii recover`
lock-subcommand is additive scope, not a bug repair, and the underlying
race is narrow (requires PID recycling on a busy host within the reclaim
window).

### L6 — A note on my own test harness's first (wrong) result for §5

My first attempt at the writer-lock-crash test produced a false result:
`isProcessAlive()` reported a `SIGKILL`'d process as still alive, and lock
reclaim failed. Investigation showed this was **an artifact of my own test
script**, not a TII defect: the child was a direct, non-detached child of
my own Node process, and my script busied its event loop with synchronous
`spawnSync` calls instead of yielding, which prevented Node from ever
reaping its own dead child (a zombie is reported alive by `kill(pid,0)`
until reaped). Redone with a **properly detached, reparented** child
(`detached:true`, `unref()`, killed from a separate shell process — the
realistic topology under systemd/launchd/Docker/pm2) the reap was
near-instant and `isProcessAlive()` correctly reported `DEAD`; a fresh
writer correctly reclaimed the lock and wrote successfully. Recorded here
per "do not hide the result" — including results about my own methodology.

### L7 — `Ledger.append()` doesn't expose an `idempotent_replay` marker (unlike `issueTII()`); `POST /api/tii/:id/events` always returns 201 (§8, minor)

`issueTII()` returns `{tii, event, idempotent_replay}`; plain `append()`
returns the raw stored event with no such marker on a replay, so
`POST /api/tii/:id/events` always answers `201 Created` even when the
write was a no-op replay of an earlier request. **No duplicate is ever
created** — the safety property holds — but a caller cannot tell "fresh"
from "replay" from this endpoint's response shape, unlike the issuance
endpoint. **Severity LOW, not fixed**: changing `append()`'s return shape
or the events route's status code touches an existing API contract broadly
for a cosmetic inconsistency with no correctness impact — outside this
task's "smallest repair" bar.

### L8 — A syntactically-valid-but-hash-wrong final event is invisible to `recovery.inspect()`/`load()` (§10)

Confirmed: a final ledger line that is valid JSON but has a tampered
`hash` field loads normally (`recovery.required: false`) — only the
separate `Ledger.verify()` chain check catches it
(`chain_verify_ok: false`). None of the `tii recover *` commands, which key
off `recovery.inspect()`, would ever fire for this case. This is an
intentional separation of concerns (crash/parse-level corruption vs.
content-level tampering are different failure classes with different
detectors by design — `spec/crash-recovery.md` is scoped to crash safety,
not tamper detection), but it means an operator must run **both** `tii
recover inspect` and `tii verify`/`tii checkpoint verify` — one does not
substitute for the other. Documented, not changed.

### L9 — No directory-level fsync (§11)

Confirmed by code review: `fsyncFile()` (`src/recovery.js`) and the ledger
append path (`src/ledger.js`) fsync the **file** they just wrote, never the
**containing directory**. On some POSIX filesystems, a newly created file's
directory entry (or a file's removal) is not guaranteed durable across a
power loss until the directory itself is fsynced — meaning that after a
real power-loss event (not a plain process crash — those preserve
already-`write()`'d data on a live filesystem), a journal or lock file's
very *existence/absence* could theoretically be inconsistent with what was
last durably fsynced, on filesystems/mount options where directory entries
aren't automatically journaled. Ext4 with `data=ordered` (the common
Linux default) and most production filesystems substantially mitigate this
in practice via their own journaling, but TII does not itself add the
directory fsync that would make this guarantee filesystem-independent. See
§11/§12 below for the explicit, honest storage-assumption statement. Not
added in this task: doing so portably (directory handles are not fsync-able
the same way on every platform) is more than a "smallest repair," and the
task's own framing for this item is "audit... document," not "fix."

---

## Section-by-section results

### 1. Signed checkpoint trust boundary — **PASS** (claims correctly separated; one policy gap, L1, documented)

- Scenario A (rewrite history, retain a prior checkpoint): internal
  `verify()` reports `ok: true` on the forged chain (blind to the forgery,
  exactly as designed); the retained checkpoint reports `VERIFIED` (the
  file itself is untouched and validly signed) with
  `matches_current_head: false` (its attested head differs from the forged
  ledger's new head) — **the forgery is exposed**, correctly, without
  collapsing the two claims.
- Scenario B (ledger + checkpoint-dir write, no key): attacker cannot edit
  an existing signed checkpoint file in place without invalidating its
  signature (`INVALID`); cannot forge a new checkpoint that verifies
  against the real keyset (`unknown-key`); **can** cause their own garbage
  file to be picked as "latest" by filename sort, producing `INVALID`
  status by default even while a genuinely valid checkpoint exists
  elsewhere in the directory (see L1).
- Scenario C (ledger write + the actual signing key): **the new,
  attacker-created checkpoint is cryptographically indistinguishable from
  a legitimate one.** This is inherent to any signature scheme (the key
  *is* the trust root), not a bug — and is exactly why §4's
  compromise/rotation/backdating questions matter.
- **Three-property classification** (as required):
  - **Internal integrity:** YES — `Ledger.verify()`, SHA-256 hash chain.
  - **Signed-head authenticity:** YES, conditionally — proves a specific
    key attested to a specific head at a claimed time; detects full-chain
    forgery *only if* a pre-forgery checkpoint was retained somewhere the
    attacker did not also compromise.
  - **Independent temporal anchoring:** **NO.** Nothing external attests
    to *when* a signature was actually created (see L2, L3). TII must not
    be described as having this property.
  - **"External anchor" terminology:** not earned until checkpoints are
    actually published outside the operator's own infrastructure — see L3.

### 2. Checkpoint loss — **PASS**

Deleting the only checkpoint: reads continue working (`verify().ok` still
computable); `verifyCheckpoint()` correctly reports `MISSING`, not
`VERIFIED` or any error; neither a direct `verifyCheckpoint()` call nor a
`getOperationalStatus()` call regenerates a checkpoint as a side effect
(confirmed: zero checkpoint files exist afterward in both cases — no
silent regeneration, as required). Deleting only the *newest* of two
checkpoints: the older one still verifies explicitly by filename, and
"latest" correctly falls back to it (this succeeds — L1 is specifically
about a *corrupted/invalid*, not *missing*, newest file).

### 3. Private-key absence — **PASS**, with an explicitly documented risk (L4)

Reads work with zero key configured. **Mutation is permitted** (this is
the documented, accepted policy — checkpointing failure never blocks a
write). `createCheckpoint()` fails closed (`NoSigningKeyError`,
`code: 'no-signing-key'`). No ephemeral key is ever generated as a side
effect. `GET /status` / `getOperationalStatus()` correctly report
`checkpoint_signing_key_configured: false` and `signed_checkpoint: MISSING`.
The risk of writing without checkpoint protection is real and is now
documented explicitly (L4) rather than left implicit.

### 4. Private-key compromise model — **FAIL** for backdating detection (confirmed, expected, not fixed) — rotation/revocation itself: **PASS**

Rotation and revocation work correctly for their stated purpose: a
pre-revocation checkpoint still verifies against its original (now
revoked) key; a post-rotation checkpoint verifies against the new key.
**But** the system **cannot** distinguish a genuinely historical signature
from a backdated one forged with a compromised pre-revocation key — proven
empirically (L2). This is the exact limitation the task predicted and
explicitly told this task not to fix.

### 5. Writer lock crash — **PASS** (after correcting a test-harness artifact, L6)

A genuinely killed-and-reaped writer process (realistic topology: detached
child reparented to init, killed from an unrelated process) leaves a stale
lock file that `GET /status`/`getOperationalStatus()` correctly reports as
`STALE_LOCK_PRESENT` (not silently `AVAILABLE`, not stuck `LOCKED`
forever). A fresh writer's next `append()` attempt correctly reclaims the
lock (via a **live PID check**, never lock age) and completes the write;
the lock file is removed afterward. Reads work throughout. No age-based
heuristic exists anywhere in `writer-lock.js` — confirmed by source
inspection, matching the explicit "do not reclaim by age alone"
requirement.

### 6. Lock ownership — **PASS**, with a documented narrow gap (L5)

Lock file fields: `pid`, `host`, `acquired_at` — no random nonce. A live
holder (even the *same* process/pid calling a second time) is never
silently displaced; a second acquisition attempt is refused
(`WriterLockedError`) until an explicit `release()`. The PID-reuse edge
case (L5) is real but narrow and does not undermine the core guarantee:
**no code path in `writer-lock.js` ever removes a lock without confirming,
via a live syscall check, that its recorded holder is dead.**

### 7. Two-process test after hardening — **PASS**

Re-run at 2, 10, and 100 concurrent writer processes (this task's own
numbers, distinct from the pre-existing 12-process permanent regression
test). All three trials: `verify().ok === true`, **zero** duplicate `seq`,
**zero** chain breaks, every attempt accounted for as either committed or
explicitly refused (`writer-locked`), no lock left behind. Refusal rate
rises with contention as expected (2 writers: 1/20 refused; 10 writers:
52/100 refused; 100 writers: 243/300 refused) because each `append()` call
retries internally for only a short bounded window (~32ms) before failing
closed — this is "fail closed with a short bounded retry," not
"serialize/queue indefinitely." **Caller-side note:** an application that
wants a write to eventually succeed under heavy contention must implement
its own retry loop; TII's writer lock does not queue requests for the
caller.

### 8. Process restart + idempotency (MANDATORY) — **PASS**

The mandated sequence — write with key K, "crash" before response,
restart, retry with the same K — produces **no duplicate canonical
event** in every crash-boundary case tested (§9's full matrix). Same key
with a **different** payload is an explicit conflict
(`idempotency_key "..." was already used for a different operation`),
never a silent merge. **Idempotency state is not an in-memory-only
cache:** it is derived entirely from the `idempotency_key` field persisted
on every canonical event (`_index()` rebuilds `_idempotency` from disk on
every `load()`), proven by loading the ledger in a brand-new `Ledger`
instance (simulating a fresh process) and confirming both the replay and
the conflict behave identically. **Not** an in-memory-only mechanism —
this would have been classified `FAIL` per the task's own rule if it were,
and it is not.

### 9. Journal crash matrix — **PASS**

All nine documented boundary points were reproduced by replaying
`Ledger.append()`'s exact sequence (build → journal write → journal fsync →
canonical write → canonical fsync → journal unlink) and stopping at each
point:

| Boundary | Canonical validity | Operator action | Duplicate possible? |
|---|---|---|---|
| 1. before journal creation | unchanged | none | no |
| 2. after journal write, before fsync | unchanged | `recover inspect` → `discard-journal` | no |
| 3. after journal fsync | unchanged | `recover inspect` → `commit-journal` | no |
| 4. mid canonical write (partial line) | malformed tail | `truncate-tail` then `commit-journal` | no |
| 5. canonical write complete, before fsync | valid & complete | `commit-journal` (no-op cleanup) | no |
| 6. after canonical fsync, journal present | valid & durable | `commit-journal` (no-op cleanup) | no |
| 7. before journal cleanup | identical to 6 | same as 6 | no |
| 8. after journal cleanup (success) | valid, terminal | none | no (idempotent replay) |
| 9. before HTTP response | same as whichever file-state applies | client retries with same key | no |

The valid historical prefix was never rewritten or silently altered in any
case — every repair requires an explicit `tii recover` invocation, and
every one of them either applies the exact originally-journaled event or
performs a no-op cleanup; none re-derives a different event.

### 10. Partial tail recovery — **PASS**

- **Truncated JSON:** malformed tail correctly identified (exact line
  number, raw bytes, parse error), last valid event and expected next
  `seq` correctly reported.
- **Partial UTF-8 sequence:** Node's UTF-8 decoder substitutes U+FFFD for
  an incomplete trailing multi-byte sequence rather than throwing; the
  resulting malformed JSON is still correctly caught by the JSON parse
  step (not a UTF-8-decode-level detector, but the end result — detection
  — is the same).
- **Valid JSON, no trailing newline:** **correctly tolerated**, not
  flagged as corruption (`parseLedgerTolerant()` explicitly handles this
  case) — this models a crash after the write syscall but before a
  newline-terminator convention some other component might expect; TII's
  own format never requires one at EOF.
- **Malformed final object** (trailing comma): correctly caught with exact
  diagnostics.
- **Correct final object, wrong hash:** correctly **not** caught by
  `recovery.inspect()`/`load()` (this is by design — see L8) but correctly
  caught by the separate `Ledger.verify()` chain check.
- **CLI `recover truncate-tail`:** confirmed to back up the damaged file
  byte-for-byte before modifying anything, report the exact removed byte
  count and starting line, and never run without an explicit invocation —
  verified via the actual CLI subprocess, not a simulation.

### 11. Directory durability — **PARTIAL** (documented; not fixed — see L9)

TII fsyncs the **files** it writes (journal, ledger) but never the
**containing directory**. This means the durability of a file's
*existence* (after `writeFileSync`/`open+write`) or *absence* (after
`unlinkSync`) across a real power-loss event depends on the underlying
filesystem's own directory-entry journaling — TII does not add its own
directory fsync to make this guarantee portable. **Supported storage
assumption, stated explicitly:** TII's crash-safety claims (spec/crash-
recovery.md) hold against process crashes and `SIGKILL` on a filesystem
with normal write-back caching (data already returned from a completed
`write()`+`fsync()` survives a process crash). They do **not** independently
guarantee directory-entry durability across power loss on filesystems/mount
configurations where directory metadata is not itself journaled — this is
a filesystem property TII relies on, not one it enforces.

### 12. Filesystem support boundary — **DOCUMENTED, mostly NOT VERIFIED beyond local POSIX**

Tested only on macOS (Darwin, APFS) in this task, same as all prior
phases. Explicit, honest statement:

| Filesystem | Status |
|---|---|
| Local POSIX-like (Linux ext4/xfs/APFS on macOS) | Exercised and passing in this task's tests and the existing suite. `O_EXCL` lock creation, `fsync`, `unlink` are all standard POSIX primitives this relies on. |
| Windows local filesystem | **NOT VERIFIED.** `O_EXCL` semantics, `fsync` behavior, and `fs.realpathSync` symlink handling on Windows (including reparse points/junctions, which are not identical to POSIX symlinks) have not been tested in this task or any prior phase. |
| Network filesystem (generic) | **NOT SUPPORTED / NOT VERIFIED.** `O_EXCL`-based locking is well known to be unreliable over several network filesystem protocols. |
| NFS specifically | **NOT SUPPORTED.** `O_EXCL` create is explicitly documented as unreliable for mutual exclusion over NFS in the general case (classic UNIX caveat). TII's single-writer lock assumes a local filesystem. |
| Serverless ephemeral filesystem (e.g. Vercel functions) | **NOT SUPPORTED as an authoritative writer**, and not intended to be — see §18: the live Vercel deployment is a **static, read-only mirror only**, confirmed by this task to expose no `/admin`, `/status`, or `/checkpoint/*` routes (all 404, because no server-side routing exists in the static output at all). |
| Container ephemeral filesystem | Works like local POSIX **as long as the container's filesystem is not itself network-backed** and the writer lock/journal/ledger files persist across the container's own lifetime; not separately tested in this task. |

### 13. Safe-directory symlink escape — **FAIL → FIXED (D1)**

See D1 above. Confirmed broken before the fix (direct symlink, nested
symlink, symlinked directory all escaped); confirmed closed after
(`fs.realpathSync`-based confinement); permanent regression test added.
`..`-traversal, absolute paths, and encoded traversal in the form field
were already correctly rejected both before and after (these were already
covered by the original P0-B lexical check and by
`test/admin-security.test.js` test J/K).

### 14. Admin token test — **PASS**

Unset token → disabled (no forms rendered, all mutation routes `401`).
Empty-string token is treated identically to unset (same code path — `!ADMIN_TOKEN`
is true for both `undefined` and `''`). Wrong token → denied. Correct
token → allowed. Token never appears in any HTML page, JSON response,
server log line (startup logging reports only whether a token is
configured, never its value), ledger event, or export — verified directly
by grepping actual HTTP responses and the exported `ledger.jsonl` for a
distinctive token value. Fully covered by the existing, expanded
`test/admin-security.test.js` (8 tests, all passing).

### 15. Public-only leakage test — **PASS** (confirms the scope claim is accurate, not a bug)

A disposable event containing a fake secret marker, recorded the way every
other event in this codebase records content (with a `content.module`
field), appears in: the raw ledger JSONL on disk, every export format
(JSON/JSONL/CSV), the API projection, the resolution HTML page (both
languages), and every corresponding file in a fresh static-site build
(`tii/<slug>.html`, `tii/<slug>.json`, `ledger.jsonl`, `ledger.csv`). It
does **not** appear in the registry summary or `catalog.json`
(`publicSummary()` intentionally exposes only a restrained set of fields —
status, lifecycle, counts — never raw event content) or in the resolution
HTML for the narrow edge case of content with **no** `content.module` key
(the "Record" section's rendering is keyed by module; unmoduled content
is stored, exported, and API-visible identically, just not picked up by
that one display section — not a privacy control, since it's fully public
on every other surface). This confirms `spec/public-only-1.0.md`'s claim is
accurate: TII 1.0 is public-only by default and any content written to it
must be treated as fully public. **This finding is not a defect and was
not "fixed"** — per the task's explicit instruction, the purpose was to
confirm the scope claim, not patch the leak.

### 16. Checkpoint / ledger divergence — **PASS** (no case collapses into another) + new finding D2 (fixed)

All seven required divergence states were reproduced and each reports a
status distinct from the others where the underlying facts differ:

| State | Status reported |
|---|---|
| Ledger newer than latest checkpoint | `VERIFIED`, `matches_current_head: false`, explanatory note |
| Checkpoint uses an unknown key (not in the trusted keyset) | `INVALID`, reason `unknown-key` |
| Checkpoint signature malformed | `INVALID`, reason `bad-signature` |
| Checkpoint JSON structurally altered / not a checkpoint at all | `MISSING` (filtered out of "latest" candidates entirely — see below) |
| Checkpoint JSON syntactically invalid | `MISSING` (same filtering) |
| Old valid checkpoint exists, **unparseable** newest checkpoint | correctly falls back to the older valid one — `VERIFIED` |
| Old valid checkpoint exists, **well-formed-but-tampered** newest checkpoint | does **not** fall back — reports `INVALID` for the tampered one (this is L1, restated precisely: the fallback works for unparseable files, not for parseable-but-invalidly-signed ones) |

No case is ever silently reported as `VERIFIED` when it should not be, and
no case is silently collapsed into a different one's vocabulary. The one
gap (L1) is an availability/auditability nuance, not a false-positive
integrity claim. **D2** (the unauthenticated `file=` parameter issue) was
discovered incidentally while constructing these states and is fixed — see
above.

### 17. Static mirror validation — **PASS**

Built a fresh static site alongside a real private signing key file, a
real checkpoint directory, a writer lock file, a journal file, and a
`.env`-style file containing a fake admin token, all sitting in the same
source directory tree as the ledger. Grepped the entire static output tree
for the private key (`BEGIN PRIVATE KEY`) and the fake token string:
**none found.** No file in the output is named anything containing
"admin"; no `.html` file contains a `POST` form or an `action="/admin`
attribute (re-confirmed; already covered by `test/admin-security.test.js`
test L). The Audit page correctly renders both distinct sections (Ledger
chain integrity / Signed checkpoint) and, since `buildStaticSite()` never
passes a `checkpoint` object, honestly shows "Not available" for the
checkpoint section rather than fabricating a claim or crashing. **Noted
limitation, not a defect:** no checkpoint file (public material) is copied
into the static output at all — a static-only consumer can never see claim
B evidence from the static bundle alone; they would need to separately
retrieve a checkpoint file from the live server's `/checkpoint/list` or
directly from `checkpoints/`. This is consistent with, not contradictory
to, "Not available" being shown.

### 18. Live deployment check — **PASS** (with one sub-item explicitly NOT VERIFIED)

Checked the live `tiiarchive.vercel.app` deployment directly (read-only,
no mutation attempted): `/`, `/registry`, `/spec`, `/audit`, `/about`,
`/ja`, `/catalog.json` all render correctly. The Audit page shows the new
two-claims layout (confirming the deployment reflects this phase's
static-build changes) with `head_hash`/`event_count` matching the local
canonical ledger exactly. `/admin`, `/status`, and `/checkpoint/list` all
return this app's own 404 page — confirming **no server-side routes exist
at all** on the static deployment (not just "admin is disabled" — there is
no live process to disable anything in). `vercel.json` confirms a
static-only build (`outputDirectory: "public"`, no functions declared).
**NOT VERIFIED:** the exact deployed commit hash is not observable from
the live site's rendered output (Vercel does not expose build provenance
in the page itself); content and behavior are consistent with commit
`4ce2d80` or a close descendant, but this is inference from content, not a
direct commit-hash confirmation. Reported as **NOT VERIFIED** for that
specific sub-claim rather than asserted as PASS.

### 19. Re-run capability matrix — see `spec/capability-matrix.json`'s new
`phase1_adversarial_verification_update` block and the corresponding
section appended to `spec/capability-boundary-audit.md`. Scores were
**not** automatically raised because Phase 1 code exists — §21 (input
security / admin file access) moves from its Phase-1-hardening-update
status to a further-refined status reflecting D1's fix *and* the
newly-found-and-fixed D2, with L1/L2/L3 recorded as continuing,
undstated-before limitations on §24/§26's claims rather than being
smoothed over.

---

## Answers to the required final questions

**What threat does a signed checkpoint now defeat?**
A full-chain regeneration attack (§26 of the original capability audit) —
an attacker with ledger write access (but not the signing key) who
rewrites history and recomputes the entire downstream hash chain, which
`Ledger.verify()` alone cannot detect. A checkpoint retained from before
the attack, held somewhere the attacker did not also compromise, exposes
the forgery via a head-hash mismatch.

**What threat does it NOT defeat?**
An attacker who additionally has the signing key (Scenario C) — the new,
attacker-signed checkpoint is cryptographically indistinguishable from a
legitimate one. Nor does it defeat backdating with a compromised
*pre-revocation* key (L2). Nor does it protect a write made while no
signing key was configured at all (L4) — there is simply nothing to check
that window against. It is not an "external anchor" in any deployment
where the checkpoint directory is not actually held independently of the
ledger's own host (L3).

**What happens after writer crash?**
The writer lock is left stale on disk but the recorded PID is dead; `GET
/status` reports `STALE_LOCK_PRESENT` (not silently available, not stuck
forever); the next real write attempt reclaims it automatically via a live
PID check (never by lock age) and proceeds normally. If the crash also
left an unfinished write-ahead journal or a malformed ledger tail, further
writes are refused (`RecoveryRequiredError`) until an operator runs the
appropriate explicit `tii recover *` command — no duplicate event and no
silent data loss occurs in any of the nine crash-boundary cases tested.

**What happens after signing-key compromise?**
Revocation correctly stops the compromised key from being trusted for
*future* checkpoints once an operator revokes it in the keyset, and
correctly leaves genuinely pre-compromise checkpoints verifiable. But
revocation cannot retroactively invalidate a *backdated* checkpoint forged
with the compromised key before an operator notices and revokes it (L2) —
this is a fundamental limitation of signature-only schemes without an
independent timestamp, not a TII-specific bug, and is explicitly out of
this task's scope to solve.

**Does idempotency survive restart?**
Yes. It is derived entirely from the `idempotency_key` field persisted on
every canonical event, not from any in-memory-only cache — proven by
loading the ledger fresh (simulating a restarted process) and confirming
both a same-key/same-payload replay and a same-key/different-payload
conflict behave identically to the pre-restart process. See §8/§9 and
Defect List item L7 for a minor, non-safety-affecting response-shape
inconsistency between `append()` and `issueTII()`.

**Can `/admin/hash-file` escape through symlinks?**
It could, before this task (D1, HIGH severity) — direct symlink, nested
symlink, and symlinked directory all escaped the configured safe
directory. **Fixed** in this task via realpath-based confinement; a
permanent regression test (`test/admin-security.test.js` test M) now
guards this.

**What exact filesystem model does the authoritative writer require?**
A local POSIX-like filesystem supporting `O_EXCL` file creation, `fsync`,
and reliable `unlink` semantics, on a single host. It explicitly does
**not** support (and was not tested for) network filesystems, NFS
specifically, or Windows. It does not fsync the containing directory, so
its crash-safety guarantee is scoped to process/OS crashes on a live
filesystem, not to power-loss durability of directory metadata on every
possible filesystem configuration — see §11/§12 and L9.

**Can the live static mirror be verified as read-only?**
Yes. `/admin`, `/status`, and `/checkpoint/list` all return the static
site's own 404 page on the live deployment — there is no server-side
routing at all in a static export, so there is no write capability to
disable in the first place. `vercel.json` confirms a static-only build
with no functions. The exact deployed commit was not independently
verifiable from the live page content alone (see §18) — reported as such
rather than assumed.

---

## Final scoreboard

| # | Item | Result |
|---|---|---|
| 1 | Signed checkpoint trust boundary | PASS (claims correctly separated; L1 documented) |
| 2 | Checkpoint loss | PASS |
| 3 | Private-key absence | PASS (risk L4 documented) |
| 4 | Private-key compromise model | FAIL for backdating detection (expected, not fixable in scope); rotation/revocation itself PASS |
| 5 | Writer lock crash | PASS (after correcting own test-harness artifact, L6) |
| 6 | Lock ownership | PASS (L5 narrow gap documented) |
| 7 | Two-process test (2/10/100) | PASS |
| 8 | Process restart + idempotency (mandatory) | PASS |
| 9 | Journal crash matrix (9 boundaries) | PASS |
| 10 | Partial tail recovery (5 corruption types) | PASS (L8 distinction documented) |
| 11 | Directory durability | PARTIAL — documented, not fixed (L9) |
| 12 | Filesystem support boundary | DOCUMENTED — local POSIX only verified; Windows/NFS/network NOT VERIFIED |
| 13 | Safe-directory symlink escape | FAIL → FIXED (D1) |
| 14 | Admin token test | PASS |
| 15 | Public-only leakage test | PASS (confirms scope claim, not a bug) |
| 16 | Checkpoint/ledger divergence | PASS (no collapsed cases; D2 found and fixed) |
| 17 | Static mirror validation | PASS |
| 18 | Live deployment check | PASS (commit-hash match specifically NOT VERIFIED) |
| 19 | Re-run capability matrix | Done — see capability-matrix.json update; no score inflated |

**Production issuance:** confirmed still `DISABLED` throughout (unchanged
by this task). **Identifier syntax:** unchanged. **No domain purchased. No
IANA submission. No new product features. No architecture redesign** —
both fixes (D1, D2) are narrow input-validation repairs to code this same
Phase 1 introduced, not new capabilities or design changes.
