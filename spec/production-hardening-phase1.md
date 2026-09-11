# TII Production-Hardening — Phase 1

**Status:** Implemented and tested. **All identifiers remain TEST identifiers.
Production issuance remains DISABLED.**

This document is the overview of Phase 1. It does not redesign TII's thin
core, its optional modules, its localization model, its public information
architecture, or its identifier syntax. It narrows and hardens the
*operational* boundary of the existing system in exactly four areas, each
documented in its own file:

| Area | Document | Summary |
|---|---|---|
| P0-A | [checkpoint-operation.md](checkpoint-operation.md) | The existing candidate Ed25519 + RFC 8785 JCS checkpoint code is wired into a live operational path, kept strictly separate from ledger chain-integrity verification. |
| P0-B | (this doc, §Admin) | `GET/POST /admin/*` now fails closed with no `TII_ADMIN_TOKEN` configured. The former arbitrary-file-read primitive is now restricted to an explicitly configured safe directory. |
| P0-C | [single-writer-model.md](single-writer-model.md), [crash-recovery.md](crash-recovery.md) | TII 1.0 formally adopts a single-authoritative-writer model with cross-process locking, a write-ahead journal for crash safety, explicit (never silent) recovery, and idempotency keys. |
| P1 | [public-only-1.0.md](public-only-1.0.md) | TII 1.0 is declared, in the specification and in the UI, to be a **public-registry-only** system. Restricted/private disclosure is explicitly NOT implemented. |

## What did NOT change

Per the governing instructions for this phase, none of the following were
touched:

- The thin-core record model (SPEC.md's event/ledger shape, module system,
  open vocabulary, append-only history) — unchanged.
- Localization (`localization.added` events, `displayContent()`) — unchanged.
- The public information architecture (Registry / Specification / Audit /
  About pages, EN/JA routing) — unchanged, only the Audit page's rendering of
  chain-integrity vs. checkpoint status was extended (see §P0-A).
- The identifier syntax. `src/candidate/identifier.js` (the 128-bit / 26-char
  Base32 candidate) remains **unwired** — `src/id.js` still issues the
  provisional 12-char token used throughout this phase.
- Production issuance. Every `identifier_status` written by the live code
  remains `"test"` (`src/ledger.js`). No env var, flag, or code path in this
  phase enables anything else.
- No domain was purchased. No submission was made to IANA. No multi-writer
  distributed issuance was implemented — see
  [single-writer-model.md](single-writer-model.md) for what *was* built
  instead (single-writer, cross-process-safe).
- No private-data subsystem was implemented — see
  [public-only-1.0.md](public-only-1.0.md).

## Baseline safety

Recorded before any Phase 1 change and re-verified after:

- Repository: `n-fujie/TII`, branch `main`.
- Canonical ledger `data/ledger.jsonl`: **byte-for-byte unchanged** across
  this entire phase (see the final report for the before/after hash).
- `data/ledger.jsonl` contains exactly one identifier, `tii:h4r3jsn4p25d`,
  `identifier_status: "test"`.
- `ledger.verify().ok === true` before and after.
- All destructive tests (forgery, crash, concurrency, recovery) ran against
  **disposable copies** created under `os.tmpdir()`, never against the
  committed ledger. `test/writer-lock.test.js`, `test/crash-recovery.test.js`,
  `test/checkpoint-store.test.js`, and `test/admin-security.test.js` each
  build their own throwaway ledger file.

## Admin fail-closed (P0-B)

`src/server.js`'s `authorized()` previously returned `true` when
`TII_ADMIN_TOKEN` was unset — i.e. an operator who forgot to set the token
got an *open* admin surface, including `GET/POST /admin/hash-file`, which
accepted **any absolute server path** and returned its SHA-256, an
arbitrary-file-read primitive.

**Rule now in force, unconditionally: NO ADMIN TOKEN = ADMIN DISABLED.**
There is no anonymous fallback, in either direction.

- `authorized(req, bodyToken)` returns `false` immediately when
  `TII_ADMIN_TOKEN` is empty — see `src/server.js`.
- `GET /admin` renders `adminDisabledPage()` (`src/views.js`) instead of any
  form when no token is configured — no issuance form, no append-event form,
  no quick-fill catalogue, no hash-file form are present in the HTML at all.
- Every admin-mutation route (`POST /api/tii`, `POST /api/tii/:id/events`,
  `POST /admin/issue`, `POST /admin/event`, `POST /admin/hash-file`) checks
  `authorized()` first and returns `401` with `{"admin_availability":
  "DISABLED"}` (or the HTML equivalent) before doing anything else.
- Token comparison is constant-time (`crypto.timingSafeEqual`, length-safe)
  — see `constantTimeEqual()` in `src/server.js`.
- The token is never echoed in any HTML page, any JSON response, any log
  line, any ledger event, or any export. Token input fields use
  `type="password" autocomplete="off"`.
- `GET/POST /admin/hash-file` no longer accepts an arbitrary server path. It
  requires `TII_ADMIN_HASH_DIR` to be configured; the supplied path must be
  relative and is resolved with `path.resolve()` + a prefix check that
  rejects anything escaping that directory (`resolveSafeHashPath()`). With no
  `TII_ADMIN_HASH_DIR`, hashing is disabled entirely — the admin page shows
  "Disabled — `TII_ADMIN_HASH_DIR` is not configured", not a live form.
- The static-export build (`exporters.buildStaticSite`) never emits an
  `/admin` page or any `POST` form — a static deployment exposes **zero**
  admin mutation capability by construction (verified by
  `test/admin-security.test.js`, test L).

Automated coverage: `test/admin-security.test.js` (6 tests) — no-token →
disabled, wrong-token → denied, correct-token → allowed, token never in any
response, token never in the ledger/exports, path-traversal and
absolute-path rejection on hash-file, and the static-deployment check.

## Test suite

`node --test` (repo root): **all 144 tests pass, 0 failing** — up from a
pre-Phase-1 baseline of 120, +24 new tests: 6 admin-security, 5 writer-lock,
5 crash-recovery, 7 checkpoint-store, plus a net +1 from a pre-existing
candidate-identifier test updated for the `src/candidate/` → `src/` move. No
pre-existing test needed its assertions changed.

## Honest cost of this phase

Crash-safe, single-writer append now does two `fsync` calls per write (the
write-ahead journal, then the ledger file itself). Measured: **~98
appends/second (~10.2 ms/append)**, down from ~7,800–9,800 appends/second
pre-hardening (`spec/performance-results.json`, `scale[1]`). This is a large,
deliberate throughput reduction traded for the property that an interrupted
append can no longer silently produce an accepted, corrupted canonical
ledger. See [crash-recovery.md](crash-recovery.md) §Cost and the updated
`spec/capability-matrix.json` / `spec/capability-boundary-audit.md` entries
for §27/§28.

This document intentionally does not claim TII is now "production ready."
Production issuance is still disabled, the candidate identifier is still
unwired, and the domain/IANA/governance questions from earlier phases remain
open. What changed is the *safety* of the machinery TII already has: a
forged chain is now catchable by an independently held checkpoint, an
unconfigured admin endpoint can no longer read arbitrary files, and a crash
mid-write no longer bricks the ledger or admits silent corruption under
concurrent writers.
