# Single-Writer Model (P0-C)

## Normative statement

> **TII 1.0 uses a single-authoritative-writer model for canonical ledger
> mutation. Multiple independent readers and mirrors are permitted.
> Concurrent independent writers to the same canonical ledger are not
> supported.**

This phase does **not** implement multi-writer distributed issuance. It
implements the single-writer model correctly and safely, including under
real multi-process contention, and makes the boundary explicit rather than
leaving it as an unstated assumption.

## Why this, not distributed writes

`spec/capability-boundary-audit.md` §28 demonstrated (before this phase) that
concurrent OS processes appending to the same `ledger.jsonl` with no
coordination produced duplicate `seq` numbers, broken `prev_hash` chains, and
`verify().ok === false` — at 100 concurrent writers, 457 duplicate `seq`
values and 384 chain breaks. A distributed multi-writer design (consensus,
CRDTs, or a coordinating service) is a materially larger undertaking than
this phase's scope, and the task explicitly excludes it. What Phase 1 does
instead is make the *single*-writer case actually safe under real
concurrency — including the case where an operator accidentally runs two
writer processes against the same ledger file, which must fail closed rather
than silently corrupt.

## Mechanism: cross-process advisory lock

`src/writer-lock.js` implements `acquireWriterLock(ledgerFile)`:

- Uses `fs.openSync(lockPath, 'wx')` — the `O_EXCL` flag makes lock-file
  creation atomic and mutually exclusive across processes on the same host;
  the OS refuses a second creation while the file exists.
- The lock file records the holder's PID.
- **Stale-lock reclaim**: if acquisition fails because a lock file already
  exists, the holder's PID is checked with `process.kill(pid, 0)` (a
  liveness probe, no signal actually delivered). If the holder process is
  dead, the stale lock is removed and reclaimed.
- **Bounded retry**: acquisition retries a small, bounded number of times
  with a short synchronous delay (`Atomics.wait` on a `SharedArrayBuffer` —
  chosen so the writer's critical section stays fully synchronous; no
  `async`/`await` runs while the lock is held, which would let JS event-loop
  interleaving reintroduce the exact race the lock exists to prevent).
- If the lock cannot be acquired after retries (a live holder), `append()`
  throws `WriterLockedError` (`code: 'writer-locked'`), which `src/server.js`
  maps to HTTP `503`. **This is a fail-closed refusal, never a best-effort
  merge.** The caller may retry; reads are entirely unaffected — the lock
  only guards mutation.
- Scope is explicitly **same-host only**. This is not a distributed lock;
  it says nothing about writers on different machines against a shared
  filesystem (e.g. NFS), which is out of scope for this phase.

## Mechanism: in-process resync (the bug this phase found and fixed)

A cross-process lock alone is **not sufficient** for correctness. During
implementation, the required 12-process concurrency regression test
(`test/writer-lock.test.js`, "§20/§26 CONCURRENCY REGRESSION") initially
still failed even with the lock correctly serializing raw file writes,
because each writer process computed the next event's `seq`/`prev_hash` from
its own **in-memory** snapshot of the ledger, taken once at process start —
stale the moment any other process wrote a new event. The lock prevented two
processes from writing *simultaneously*; it did not prevent two processes
from independently computing *conflicting* next-event fields from
out-of-date in-memory state and then writing those, serially but wrongly.

The fix: `Ledger._resyncIfChanged()` is called inside `append()`'s locked
critical section, immediately after acquiring the lock. It compares the
ledger file's current byte size against `_lastKnownSize` (recorded at the
last `load()`/successful `append()`); if unchanged, no reload is needed
(nothing else could have written while this process held the exclusive
lock); if changed, the full ledger is reloaded from disk before the new
event is constructed. Because this check runs *while holding the lock*, it
is race-free: a size mismatch can only mean another process's completed,
already-committed write, never a write-in-progress. This restores
correctness without paying the cost of an unconditional full reload on
every single-process append (which would make bulk-append effectively
O(n²) in the common case where nothing else is touching the file). After
this fix, the 12-process × 10-append test passes cleanly with zero
duplicate `seq` values and zero chain breaks (`test/writer-lock.test.js`).

## Required behavior under contention (verified)

`test/writer-lock.test.js`:

- **A second writer process, while a first holds the lock, refuses
  mutation and fails closed** — no best-effort concurrent write is ever
  attempted (`WriterLockedError`).
- **Reads remain possible** while another process holds the writer lock —
  the lock only guards `append()`, not `load()`/`verify()`/projection.
- **A stale lock (dead PID) is reclaimed**, reported, and never causes
  canonical ledger bytes to be touched incorrectly.
- **§20/§26 CONCURRENCY REGRESSION** (required to remain permanently in the
  suite): 12 separate OS processes × 10 append attempts each against one
  shared ledger file. Expected — and observed — result: `verify().ok ===
  true`; no duplicate `seq`; `seq` strictly monotonic;
  `totalOk + totalRefused === 120` (every attempt is accounted for — nothing
  silently vanished); no leftover lock file after all processes exit. This is
  *not* "all 120 writers succeed" — under contention some legitimately
  receive `WriterLockedError` and are expected to retry or fail at the
  caller's discretion; the invariant is that the ledger never corrupts and
  no attempt is silently dropped.

## Issuance and collision checks are inside the same critical section

`issueTII()`'s identifier-collision check and the resulting `append()` that
records `tii.issued` happen under the same writer lock as any other append —
there is no separate, unsynchronized "check, then later write" gap in which
two processes could mint the same identifier.

## Idempotency (not part of the TII identifier)

A minimal idempotency mechanism suited to a single-writer model:

- Callers may supply an `idempotency_key` (HTTP: `Idempotency-Key` header or
  `idempotency_key` body field; CLI: `--idempotency-key`).
- `Ledger._idempotency` maps key → `event_id`. On `issueTII`/`append`, if the
  key was already used **for the same kind of operation**, the original
  result is returned unchanged (`idempotent_replay: true`) — no new event,
  no new identifier. If the key was already used for a **different**
  operation, the call is rejected as a conflict rather than silently
  reinterpreted.
- The idempotency key is stored on the event as an ordinary field
  (`event.idempotency_key`) for audit purposes, but **it is never encoded
  into the TII identifier itself** — identifiers remain independent of any
  client-supplied deduplication token, per the task's explicit instruction.
- This directly closes the gap found in the pre-Phase-1 audit (§27): "two
  identical `append()` calls produce TWO events... no idempotency key,
  dedup, or request-id... a client that retries after a lost response
  silently double-records." A retried request with the same idempotency key
  now returns the original result instead of creating a duplicate.
