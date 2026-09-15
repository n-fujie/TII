# TII Production Launch Gate — Final Pre-Issuance Audit

**Date:** 2026-09-11. **Commit at start of this phase:** `5f37f77`.
**Question this document answers:** *"Is TII ready to issue its first
production identifier?"* **Answer: NO.** See §Final Decision Table.

This phase does not redesign any previously established component (thin
core, optional vocabulary, historical preservation, localization, external
PID association, portability/reconstruction, single-writer operation,
crash-safe recovery, fail-closed administration, signed checkpoints, the
chain-integrity/checkpoint-authenticity separation, public-only scope, or
the adversarial-verification findings). It wires the previously-candidate
production identifier profile into a real, multiply-gated, currently-closed
issuance path, and produces the governance/resolver/IANA/security/
succession/release documentation a real launch would require — while
issuing nothing.

## §0 Absolute rule — confirmed held

**No production TII was issued during this task.** No existing test
identifier was promoted. No 12-character historical identifier became
production. No externally visible production issuance endpoint was
enabled (confirmed: `src/server.js` does not import
`src/production-issuance.js` — `test/production-gate.test.js` "§0 no HTTP
route exposes production issuance"). The production switch
(`TII_PRODUCTION_ISSUANCE_ENABLED`) is unset in this repository's committed
configuration and was never set to `"true"` by any code this task added.

## §1 Baseline snapshot

| Item | Value |
|---|---|
| git commit (start of this phase) | `5f37f77` |
| Full test count (start) | 146 (end of the adversarial-verification phase) — see §49 for the end-of-phase count and exact accounting of the +29 net new/replaced tests |
| `data/ledger.jsonl` md5 | `fb56b2a4a2f5fe134f3fa23e2186e7d1` |
| Event count | 10 |
| Head hash | `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95` |
| `verify()` | `{ ok: true, problems: [] }` |
| Existing identifiers | `tii:h4r3jsn4p25d` — the only one |
| Identifier statuses | `"test"` — the only value present, and the only value any TEST code path (`src/ledger.js` `issueTII()`) can ever write |
| Checkpoint status | `MISSING` — no checkpoint has ever been created against this ledger |
| Production issuance status | `DISABLED` |
| Resolver configuration | `TII_RESOLVER_BASE_URL` unset in the repository; live interim deployment at `tiiarchive.vercel.app` (non-canonical) |
| IANA registration status | `NOT SUBMITTED`; registry re-confirmed to contain no `tii` entry (live check, 2026-09-11 — see §G9) |
| Governance placeholders | P/A Institute as *candidate* steward (`spec/governance-candidate.md`) — legal entity identity UNRESOLVED |

All existing identifiers confirmed test-only (`grep -o
'"identifier_status":"[a-z]*"' data/ledger.jsonl` → `test`, exactly once).
All destructive/gate testing in this phase used disposable ledgers under
`os.tmpdir()` (`test/production-gate.test.js`) — the canonical ledger above
is unchanged after this phase (see §Final Report for the after-value,
identical to this baseline).

## §G1 — Identifier syntax: frozen

**TII Identifier Syntax 1.0** is frozen (specification level — see
`spec/identifier-syntax-1.0-candidate.md` Appendix B). Profile, reconfirmed
unchanged from the freeze-audit candidate:

- `tii:<token>`, token = 128 CSPRNG bits, RFC 4648 Base32, unpadded,
  lowercase, exactly 26 characters, alphabet `a-z2-7`.
- No metadata encoded: no issuer/version/date/institution/content-type/
  state/transition/ignition semantics, no resolver information, no
  checksum field.
- Non-canonical Base32 tail rejected; final character restricted to
  `{a, e, i, m, q, u, y, 4}` (the 128-bit → 26-char zero-pad-tail rule,
  reconfirmed).
- No fuzzy substitution (`0→o`, `1→l/i`, `8→b` all hard errors).
- Uppercase input normalizes to lowercase only via the existing, unchanged
  canonicalization rule — no new normalization was added.

**Implementation:** `src/identifier.js` (promoted this phase from
`src/candidate/identifier.js` — see `src/candidate/README.md`).
**No version, date, or category string ever enters the token** — verified
structurally (the generator takes no such parameters) and by
`test/identifier.test.js`'s existing "no semantic metadata" test.

**Freezing this specification is independent of every other gate below** —
see `identifier-syntax-1.0-candidate.md`'s Appendix B for the explicit
statement that this freeze alone does not authorize issuance.

**Status: PASS.**

## §G2 — Production issuance isolation: wired, gated OFF

`src/identifier.js` is now connected to a real append path
(`src/production-issuance.js`), entirely separate from the TEST path
(`src/ledger.js` `issueTII()`, which always uses `src/id.js`'s 12-character
generator). **Production issuance MUST remain disabled — and does.**

### The gate (`src/production-gate.js`)

`TII_PRODUCTION_ISSUANCE_ENABLED` — strict-parsed: **only** the exact
string `"true"` is true; absent, empty, `"false"`, `"1"`, `"TRUE"`,
whitespace, or any other value is false. This is ANDed with eight further
independent conditions — no single variable, and no single condition of
any kind, is ever sufficient alone:

| Condition | What it checks | Inferred from NODE_ENV/hostname/branch/etc.? |
|---|---|---|
| `production_requested` | `TII_PRODUCTION_ISSUANCE_ENABLED === "true"` | No |
| `identifier_profile_frozen` | G1 above (fixed `true` — the spec is frozen) | No |
| `governance_approved` | `TII_GOVERNANCE_APPROVED === "true"` | No |
| `resolver_approved` | `TII_RESOLVER_APPROVED === "true"` | No |
| `iana_gate_satisfied` | `TII_IANA_GATE_SATISFIED === "true"` | No |
| `signing_ready` | a real, loadable signing key is configured (`checkpointStore.resolveSigningKey()`) | No — presence of a key for OTHER purposes (e.g. TEST checkpointing) does not leak in; this IS the same check, by design, since a key is a key |
| `writer_healthy` | no stale lock, no recovery-required state (`src/status.js` + `src/recovery.js`) | No |
| `recovery_clear` | no malformed tail / orphaned journal | No |
| `checkpoint_current` | the latest checkpoint's attested head matches the ledger's CURRENT head (G4 policy) | No |

`admin_authenticated` is deliberately **not** part of this static
computation — it is a per-request fact the caller (the CLI, or any future
HTTP route) must check in addition to, never instead of, everything above.

Verified by `test/production-gate.test.js` (28 tests): every listed
fail-closed case from the task's §7 (absent/empty/false/malformed flag;
flag true with any ONE of governance/resolver/IANA/signing/writer/recovery/
checkpoint-currency unsatisfied) independently blocks; `NODE_ENV=production`,
`VERCEL=1`, `VERCEL_ENV=production`, and a configured `TII_ADMIN_TOKEN`
are all confirmed to have **zero effect** on the gate.

### The dry-run mode (`tii issue --production --dry-run`)

Generates a candidate, shows the intended event, reports gate status — and
is structurally incapable of writing: the dry-run branch never calls
`ledger.append()` at all. Verified: after a dry-run with the gate
artificially open (disposable ledger only), `ledger.events.length === 0`
both in-memory and reloaded fresh from disk.

### Collision handling (§10 of the task)

Generate → encode → optimistic pre-check → attempt append (which
re-validates uniqueness a second time, **authoritatively, inside the
writer lock**, via `Ledger._validateAppend()`) → on a genuine collision,
discard and draw a new candidate; only the surviving candidate is ever
appended. Deterministically tested by monkey-patching the generator to
force an exact collision, then verifying: (a) the collided candidate
appears in the canonical ledger exactly zero or one times — never twice —
and (b) the retry with a fresh candidate succeeds.

**No production issuance HTTP endpoint exists** (§0's requirement) —
confirmed structurally (`src/server.js` does not import
`src/production-issuance.js`) and by test.

**Status: PASS.**

## §G3 — Cryptographic key custody: documented, not executed

> **Status at original writing: no key generated.** A key ceremony has
> since run (2026-09-12) — key generated, signing/verification/tamper
> tests all passed. **G3 remains CONDITIONAL PASS**, pending the human
> operator's confirmation of independent offline recovery-copy placement.
> See the G3 ceremony note appended at the end of this document and
> `spec/production-key-custody.md` §8 for full detail.

Full model: `spec/production-key-custody.md`. Summary: five things kept
distinct (private key / public key / key id / checkpoint records /
rotation metadata); private key never committed, never in the ledger,
never exported, never in the static mirror, never in an API response,
never rendered, never logged (all previously verified empirically in the
adversarial-verification phase, re-affirmed here as policy); an explicit
key-generation, backup, access, publication, rotation, and
compromise-declaration procedure is documented.

**No production key was generated by this task.** The key-compromise +
backdating limitation from adversarial verification is preserved verbatim,
not re-solved (`spec/production-key-custody.md` §6) — no trusted
timestamping is claimed.

**Status: CONDITIONAL PASS** — the model and procedure are complete and
correct; the gate itself (`signing_ready`) correctly reports `false` today
because no key exists. This becomes PASS the moment a real production key
is generated and configured per the documented procedure — not before.

## §G4 — Signed checkpoint operation: policy frozen

**Chosen policy: A — checkpoint after every authoritative production
mutation.** (Task §16 explicitly "strongly prefer[s] a policy that
minimizes unauthenticated history windows" at current scale; policy A
does that maximally.)

Sequence, implemented in `issueProductionTII()`
(`src/production-issuance.js`): append (already fsynced by
`src/ledger.js`) → attempt `checkpointStore.createCheckpoint()`
immediately → report the outcome in the return value
(`production_checkpoint: {status: 'CREATED'|'FAILED', ...}`), never
silently.

**Signing-failure policy (§17), implemented exactly as specified:**

- The mutation is **not hidden** — it stays in canonical history exactly
  as appended (`do not pretend the write did not happen`).
- Checkpoint status is surfaced as `FAILED`, not swallowed.
- **Further production mutations are disabled** until checkpoint currency
  is restored: `checkpoint_current` (§G2's gate) becomes `false` the
  moment the ledger head moves past the latest checkpoint's attested head,
  and stays `false` until a new checkpoint is successfully created —
  blocking every subsequent `issueProductionTII()` call via the same gate
  mechanism used for every other precondition. No separate "halt flag" was
  needed; the checkpoint-currency condition already produces exactly this
  effect.
- **History is never rolled back.** Recovery is "create a new checkpoint,"
  never "undo the append."

Verified end-to-end: `test/production-gate.test.js` "§17 if checkpoint
creation fails..." — sabotages checkpoint creation for exactly one call,
confirms the mutation is committed and visible, confirms the *next*
production issuance attempt is refused by the gate, and confirms operator
recovery (re-running `checkpointStore.createCheckpoint()`) restores
availability.

**Status: PASS.**

## §G5 — Authoritative writer: final check

Re-ran the multi-process concurrency suite at 2, 10, and 100 writers
(reusing the methodology from `spec/phase1-adversarial-verification.md`
§7, re-confirmed current via the existing permanent regression test,
`test/writer-lock.test.js` "§20/§26 CONCURRENCY REGRESSION," passing in
this phase's full suite run). Result, unchanged from the adversarial
phase: **zero duplicate `seq`, zero broken hash links at every scale**;
stale in-memory head corruption remains fixed (the resync-under-lock
mechanism from production-hardening Phase 1); a second writer either waits
briefly (bounded internal retry) or fails closed
(`WriterLockedError`/`code: 'writer-locked'`), never merges; reads remain
available throughout. **No claim of distributed multi-writer support is
made anywhere** — `spec/single-writer-model.md`'s normative statement is
unchanged and reconfirmed: TII 1.0 is single-authoritative-writer.

**Status: PASS.**

## §G6 — Recovery and idempotency: final check

Re-confirmed via the existing, still-passing permanent test suites
(`test/crash-recovery.test.js`, `test/writer-lock.test.js`) and the full
9-boundary journal crash matrix and 5-type partial-tail-recovery
diagnostics already established in
`spec/phase1-adversarial-verification.md` §9/§10 (unchanged this phase —
"do NOT redesign these components"): valid prefix always survives;
incomplete writes surface `recovery_required`, never silently accepted;
malformed tail is reported with exact byte range, never ignored; explicit
recovery (`tii recover truncate-tail`/`commit-journal`/`discard-journal`)
always produces a report and always backs up the damaged source first;
recovery never rewrites a byte of earlier valid history.

**Idempotency**, the mandatory scenario: request with key K → committed →
simulated crash before response → restart (fresh `Ledger` instance,
modeling a new process) → retry with the same K → same result returned, no
duplicate event. Same K with a different payload → explicit conflict, no
silent merge. State survives restart because it is derived entirely from
the `idempotency_key` field persisted on every canonical event, not an
in-memory cache — this was proven in the adversarial-verification phase
(§8) and is unchanged. `issueProductionTII()` accepts the same
`idempotency_key` parameter and passes it through unchanged to
`ledger.append()`, inheriting this property directly rather than
reimplementing it.

> **Correction (2026-09-15):** the last sentence above did not hold for
> `issueProductionTII()` specifically — it inherited the *safety*
> property (no duplicate/corrupted issuance) but not the *graceful
> same-result-on-retry* property, because it generated a fresh random
> candidate on every call rather than replaying a caller-supplied one.
> **Fixed the same day** — see "G6/G14 idempotency repair" at the end of
> this document for the full finding, the fix, and the proof.

**Status: PASS.** (Briefly CONDITIONAL PASS on 2026-09-15 between the
finding above and the fix recorded at the end of this document — see
that closure note for the repair and its proof.)

## §G7 — Permanent resolver domain

> **Status at original writing: no domain purchased.** Since resolved to
> PASS — see the G7 closure note appended at the end of this document and
> `spec/resolver-domain-decision.md` §15–§18 for the registrar change,
> the purchase, and full independent verification.

**No domain purchased. No DNS changed.** Live RDAP re-check performed
2026-09-11 (this phase), method validated against a known-registered
control domain (`example.org`, confirmed to return live registration data
rather than a 404):

| Candidate | Role (this task's framing) | RDAP result (2026-09-11, this phase) |
|---|---|---|
| `transition-ignition-id.org` | **PRIMARY, brand-safety** | HTTP 404 — **available** |
| `tii-id.org` | SECONDARY | HTTP 404 — **available** |

Both remain available as of today, consistent with — and re-confirming,
same-day-current — the prior analysis in
`spec/resolver-domain-decision.md` (which itself carries a full
pricing/registrar/DNSSEC/collision analysis, unchanged and not
re-litigated here). `tii-id.org` remains conditional on a trademark/
confusion-clearance search that has **not** been performed (Technology
Innovation Institute, `tii.ae`, is the material collision risk). This
task's framing prefers `transition-ignition-id.org` as primary for exactly
that reason — it has minimal collision exposure and needs no clearance
search.

**Neither domain is registered by this task, with or without
authorization having been sought.**

**Status: CONDITIONAL PASS** — the decision framework is complete, both
candidates are confirmed currently available, and a clear primary
recommendation exists; this becomes PASS only once a domain is actually
purchased and DNS-configured under separate, explicit authorization
(`spec/resolver-domain-decision.md` §11's operational requirements).

## §G8 — Governance finalization

Required distinctions (`spec/governance-candidate.md`, unchanged this
phase; see also `spec/governance-finalization.md`, added in the follow-up
External Infrastructure Closure phase, for the seven-role separation, the
two non-inventive legal-identity models, and the human-input form):

| Field | Status |
|---|---|
| Official name | Transition-Ignition Identifier — fixed |
| Abbreviation | TII (non-exclusive) — fixed |
| Current specification steward | P/A Institute — **candidate, not finalized** |
| **Legal entity** (if P/A Institute is not itself a legal entity name) | **UNRESOLVED** |
| IANA named contact (real accountable person) | **UNRESOLVED — not established by this task** |
| IANA role address | `standards@<domain>` — depends on G7, not created |
| Change Controller | P/A Institute, acting as current steward — **candidate, pending approval** |
| Hosting operator, registrar, signing-key custodian | replaceable operational roles — correctly kept distinct from "owner" (`governance-candidate.md` §0) |

**Per this task's explicit instruction: "If legal status is unresolved: G8
= UNRESOLVED. Do not guess."** No legal entity name is invented here. No
named individual is supplied as the IANA contact — doing so would require
information this task does not have and is not authorized to fabricate.
The normative wording preserving "change controller is a current
stewardship role, not identifier identity, transferable under the
Succession Policy" (`spec/governance-candidate.md` §2) is unchanged and
reconfirmed correct.

**Status: UNRESOLVED.**

## §G9 — IANA URI scheme status

Immediate, live re-check of the official IANA *URI Schemes* registry
performed this phase (2026-09-11): **`tii` still does not appear**, as
registered, provisional, or historical. No STOP condition triggered — see
`spec/iana-provisional-registration.md`'s "G9 re-check" section for the
exact result and method.

The RFC 7595 provisional registration draft
(`spec/iana-provisional-registration.md`) remains submission-ready on its
technical fields (syntax, encoding, interoperability, security, fragment
handling, resolution behavior, examples — all frozen per G1) and
explicitly marked `[GOV — unresolved]` on its governance fields (contact,
change controller, specification URL), which depend on G7/G8 resolving
first. **Not submitted. No improvised suffix. No silent scheme change.**

**Status: CONDITIONAL PASS** — technical readiness is complete and the
registry is confirmed clear; becomes PASS (or the submission actually
proceeds) only once G7/G8 resolve and an explicit filing decision is made.

## §G10 — Public-only TII 1.0

Unchanged, reconfirmed (`spec/public-only-1.0.md`): TII 1.0 public registry
MUST NOT be used for secrets, credentials, private personal information,
embargoed evidence, restricted security information, or material requiring
confidential disclosure. No privacy functionality is advertised anywhere.
The PUBLIC RECORD warning banner on the admin/write interface is unchanged
and still renders (verified by the existing, still-passing
`test/admin-security.test.js` suite).

**Status: PASS.**

## §G11 — Security: final audit

Re-ran the full known attack suite via the existing, comprehensive
automated test suite (175/175 passing at the end of this phase — see
§Test Suite) plus the complete adversarial-verification pass carried
forward unchanged from the prior phase
(`spec/phase1-adversarial-verification.md`): admin token
absent/wrong/correct; path traversal; symlink escape (direct, nested,
symlinked-directory — D1, fixed with a permanent regression test);
checkpoint filename traversal (D2, fixed with a permanent regression
test); malformed checkpoint (JSON-invalid and structurally-invalid, both
correctly rejected — `test/checkpoint-store.test.js`); arbitrary file-read
attempts (both the hash-file and checkpoint-verify vectors, both closed);
HTML/script/SVG injection, `javascript:` URLs, control characters, Unicode
bidi (`spec/security-test-results.md` — unchanged, no execution path
found); malformed JSON and duplicate JSON keys (`test/jcs.test.js` — RFC
8785 §3.1 duplicate-key rejection); oversized requests (5 MB body cap,
`spec/capability-boundary-audit.md` §30); malformed TII, invalid Base32,
non-canonical tail (`test/identifier.test.js`); replayed mutation and
idempotency conflict (§G6 above).

**No known HIGH-severity exploitable issue remains for the intended
initial deployment model.** The two HIGH/MEDIUM-HIGH issues found during
the adversarial-verification phase (D1 symlink escape, D2 unauthenticated
checkpoint-file-param read) are fixed with permanent regression tests, not
merely noted.

**Status: PASS.**

## §G12 — Reconstruction and succession

Reconstruction from source + canonical export + specification + public
verification keys + checkpoints, in a fresh environment, demonstrated
repeatedly and unchanged this phase
(`spec/capability-boundary-audit.md` §32, `test/capability-regression.test.js`):
identifiers, complete history, translations, optional modules, and
external PID relations all survive; static pages rebuild; the original
Vercel deployment is not required. Checkpoint verification specifically
was not part of the original §32 demonstration (no checkpoint existed at
that time) but is independently proven by
`test/checkpoint-store.test.js`'s create → export the file → verify in a
completely separate process/directory pattern used throughout that suite.

**Complete-operator-loss drill:** modeled in
`spec/succession-manifest.md` §10 — reconstructable identity/history is
kept explicitly separate from lost authority credentials, lost domain
continuity, and lost signing-key custody; no succession claim is
overstated.

**Succession manifest** (`spec/succession-manifest.md`, new this phase):
non-secret, lists specification location, canonical ledger format and
current state, checkpoint status (none exist), verification key status
(none exist), resolver dependencies, registrar recovery requirements (not
applicable — no domain), IANA change-controller procedure, source location,
and exact rebuild instructions. **No private key material included.**

**Status: PASS.**

## §G13 — Release artifacts

| Artifact | File | Status |
|---|---|---|
| TII Identifier Syntax and Resolution Specification 1.0 | `spec/identifier-syntax-1.0-candidate.md` | frozen (Appendix B) |
| Governance and Succession Policy | `spec/governance-candidate.md`, `spec/succession-policy.md`, `spec/succession-manifest.md` | complete — governance resolved 2026-09-11 (G8 PASS, `spec/governance-finalization.md` §10); this cell corrected 2026-09-12 as an administrative consistency update, not a reopening of accepted technical content |
| Public-Only Scope Policy | `spec/public-only-1.0.md` | complete |
| Checkpoint Verification Specification | `spec/checkpoint-operation.md` | complete |
| Single-Writer Operational Model | `spec/single-writer-model.md` | complete |
| Crash-Recovery Procedure | `spec/crash-recovery.md` | complete |
| Security Considerations | `spec/security-test-results.md`, `spec/phase1-adversarial-verification.md`, `spec/iana-provisional-registration.md` §Security | complete |
| IANA Provisional Registration Draft | `spec/iana-provisional-registration.md` | submission-ready on technical fields; governance fields pending |
| Machine-readable test vectors | `spec/test-vectors.json` | complete, unchanged |
| Capability and limitation statement | `spec/capability-boundary-audit.md`, `spec/capability-matrix.json` | complete, continuously appended, not erased |

New this phase: `spec/production-launch-gate.md` (this document),
`spec/first-production-issuance-procedure.md`,
`spec/production-key-custody.md`, `spec/production-release-claims.md`,
`spec/succession-manifest.md`, `spec/launch-status.json`.

**Labeled: "TII 1.0 Production Candidate."** Not labeled final — final
requires the steward's explicit review and acceptance, which is outside
this task's authority to grant.

**Status: PASS** *(accepted 2026-09-12 — see the closure note appended at
the end of this document)*. The bundle was CONDITIONAL PASS from this
phase's original writing until the steward explicitly accepted it; every
required document existed and was internally consistent throughout, and
"final" acceptance was always the only thing withheld pending an actual
steward decision.

## §G14 — First production issuance procedure

Written in full: `spec/first-production-issuance-procedure.md` — 22 steps,
preconditions (every gate must read a firm PASS, not CONDITIONAL PASS),
explicit stop/recovery behavior if checkpoint creation fails at step 17,
explicit idempotent-retry guidance if the procedure is interrupted, and an
explicit content-discipline section (§43/§44 — no ontology dump, no
self-certifying claims) cross-referenced to
`spec/production-release-claims.md`.

**Not executed. Step 11 onward was not performed.**

> **Correction (2026-09-15):** the "explicit idempotent-retry guidance"
> referenced above was itself found inaccurate by direct rehearsal, then
> **fixed the same day** in both code and
> `spec/first-production-issuance-procedure.md`. See "G6/G14 idempotency
> repair" at the end of this document for the full finding, the fix, and
> the proof.

**Status: PASS.** (Briefly CONDITIONAL PASS on 2026-09-15 between the
finding above and the fix recorded at the end of this document.)

---

## §15 Checkpoint trust layers (restated, unchanged)

Kept distinct throughout this phase, exactly as established by adversarial
verification and not re-litigated:

1. **Internal chain integrity** — implemented (`Ledger.verify()`).
2. **Signed checkpoint authenticity** — implemented
   (`src/checkpoint-store.js`), now with a frozen production policy (§G4).
3. **Independent external witness / timestamp** — **NOT implemented.**
   Explicitly optional/future. **Not represented as already available.**
   `spec/production-key-custody.md` §6 restates the exact backdating
   limitation this implies and does not claim trusted timestamping or
   immutable historical existence.

## §31 Fragment rule (regression check)

Reconfirmed correct and unchanged: `tii:<token>#fragment` is a valid URI
reference (RFC 3986); the fragment is not part of the token, does not
affect registry lookup, and receives no TII-specific semantics
(`spec/identifier-syntax-1.0-candidate.md`, `test/identifier.test.js`'s
fragment-handling test, unchanged and still passing).

## §48 Final performance check

Re-measured this phase (Apple M1, darwin arm64, consistent with prior
measurements):

- **Single authoritative append (production-path-equivalent, crash-safe):**
  ~98 appends/sec, ~10.2 ms/append (unchanged from production-hardening
  Phase 1's measurement — the production path uses the identical
  `Ledger.append()` machinery, just a different token generator upstream
  of it; no new performance characteristic was introduced).
- **Checkpoint generation:** not independently re-timed this phase; no
  change to `src/checkpoint-store.js`'s implementation in this phase.
- **Registry resolution, static rebuild, ledger verify, checkpoint
  verify:** unchanged from `spec/performance-results.json` — no code in
  the read/render/export paths was touched.

**No optimization performed** — no launch-blocking performance defect was
observed. **The existing ~100 durable writes/sec scale is accepted as
entirely acceptable for initial operation**, exactly as anticipated.

## §49 Final test suite

`node --test`: **175/175 passing, 0 failing** at the end of this phase, up
from 146 at the start (`test/candidate-identifier.test.js`'s 18 tests
became `test/identifier.test.js`'s 19 — one test replaced by two more
specific ones reflecting the gated-wiring reality, net +1 — plus 28 new
tests in `test/production-gate.test.js`: 146 − 18 + 19 + 28 = 175).
Includes: all legacy tests,
candidate/production identifier tests (`test/identifier.test.js`,
renamed and updated in place — no assertion was weakened, two were
replaced with equivalent-or-stricter versions reflecting the now-accurate
"this module IS wired, but gated" reality), checkpoint tests, JCS tests,
admin security tests (including the two new permanent regression tests
from adversarial verification), writer-lock tests, crash-recovery tests,
the adversarial-verification-phase security tests (unchanged, carried
forward), and 28 new production-gate tests (fail-closed matrix, dry-run,
a production-path integration test against an isolated disposable ledger,
checkpoint policy, collision handling, test/production separation). **No
pre-existing test was weakened to obtain a green result** — the only test
behavior changes are in `test/identifier.test.js`'s final two tests, which
were REPLACED (not weakened) because the fact they tested — "this module
is not wired anywhere" — became false by explicit design this phase (G2),
and the replacement tests assert the more specific, still-strict property
that actually holds now: wired only into the gated production path, never
into any TEST or public-surface code path.

## §50 No silent migration — confirmed

`tii:h4r3jsn4p25d` remains `identifier_status: "test"` — unchanged,
unrenamed, unregenerated, never used as, or considered for, the first
production TII. Confirmed by direct inspection of `data/ledger.jsonl`
(§Final Report) and by `test/production-gate.test.js`'s explicit
non-promotion tests.

---

## Final Decision Table

| Gate | Status |
|---|---|
| G1 — Identifier syntax | **PASS** |
| G2 — Production issuance isolation | **PASS** |
| G3 — Key custody | **PASS** *(resolved 2026-09-13 — see the closure note appended at the end of this document)* |
| G4 — Signed checkpoints | **PASS** |
| G5 — Writer safety | **PASS** |
| G6 — Recovery/idempotency | **PASS** *(briefly downgraded and re-closed same day, 2026-09-15 — see "G6/G14 idempotency repair" appended at the end of this document)* |
| G7 — Resolver | **PASS** *(resolved 2026-09-12 — see the closure note appended at the end of this document)* |
| G8 — Governance | **PASS** *(resolved 2026-09-11 — see the closure note appended at the end of this document)* |
| G9 — IANA | **PENDING IANA** *(submitted 2026-09-13 — see the closure note appended at the end of this document)* |
| G10 — Public-only policy | **PASS** |
| G11 — Security | **PASS** |
| G12 — Reconstruction/succession | **PASS** |
| G13 — Release artifacts | **PASS** *(accepted 2026-09-12 — see the closure note appended at the end of this document)* |
| G14 — First-issuance procedure | **PASS** *(briefly downgraded and re-closed same day, 2026-09-15 — see "G6/G14 idempotency repair" appended at the end of this document)* |

## OVERALL LAUNCH STATUS: **NOT READY**

Production launch requires every gate to read PASS. At the time this
section was originally written, five did not: G3 (no production key
generated yet — procedure ready), G7 (no domain purchased — candidates
confirmed available today), G8 (governance legal identity genuinely
unresolved — not guessed), G9 (IANA not submitted, pending G7/G8), and G13
(release artifacts complete but pending steward acceptance). **G8, G13,
G7, and G3 have since resolved — see the closure notes at the end of this
document.** One now does not: G9 — submitted to IANA 2026-09-13, now
PENDING IANA, not yet PASS (submission is not registration). **There is
still no automatic launch.** This
document prepares TII for issuance. It does not authorize it.

---

## External Infrastructure Closure (appended 2026-09-11, same day)

G3, G7, G8, and G9 above were closed further — to "ready pending explicit
human authorization" — in a dedicated follow-up phase. **None changed
status** (G3/G7/G9 remain CONDITIONAL PASS, G8 remains UNRESOLVED; overall
launch status is unchanged: **NOT READY**) — what changed is that every
remaining blocker for each is now a named human decision or an
already-specified external action, not an open-ended "more work needed."
Full detail, a live RDAP/IANA re-check performed the same day, a frozen
domain/registrar recommendation, a governance role-separation model with a
human-input form, an extended key-custody model (storage comparison,
generation ceremony, key-loss model), a consolidated HUMAN DECISIONS
REQUIRED list, and a final closure table with an exact "next irreversible
action" per gate: [external-infrastructure-closure.md](external-infrastructure-closure.md).
New/extended companion documents:
[governance-finalization.md](governance-finalization.md) (new — role
separation, legal-identity models A/B, human-input form),
[resolver-domain-decision.md](resolver-domain-decision.md) §14 (domain/
registrar decision frozen, authorization packet, DNS plan),
[iana-provisional-registration.md](iana-provisional-registration.md)
(technical fields finalized, submission authorization packet),
[production-key-custody.md](production-key-custody.md) §7 (storage
options, generation ceremony, key-loss model),
[succession-manifest.md](succession-manifest.md) §11–§12 (operational
roles, bus-factor audit).

This phase also corrected an audit-phrasing issue in the prior phase's §49
and in `test/production-gate.test.js`: the one test exercising the
non-dry-run production-issuance branch is now titled and commented as a
**"production-path integration test (isolated disposable ledger)"**
minting an **"ephemeral generated identifier"** — never described as a
production TII — with a new regression assertion confirming that
identifier never appears in the canonical `data/ledger.jsonl`. See
`external-infrastructure-closure.md` §0.

---

## G8 closure (appended 2026-09-11) — G8: UNRESOLVED → PASS

Through a dedicated human-decision-capture process
(`spec/human-decisions.md`, `spec/governance-finalization.md` §10), the
human operator explicitly supplied every field G8 required — none
inferred, none accepted by silence:

- Legal-identity model: **Model A, individual Change Controller.**
- Legal/accountable name: **Naoto Fujie.**
- Relationship to "P/A Institute": **"Naoto Fujie is an individual
  operating publicly as P/A Institute"** — explicitly confirmed, not the
  agent's suggested wording accepted by default (it was first offered
  conditionally, left unresolved for two full exchanges, and only
  recorded once the operator confirmed it in those exact words).
- IANA named contact: **Naoto Fujie.**
- IANA Change Controller: **Naoto Fujie**, per the normative principle
  (unchanged): a stewardship role, not TII identifier identity,
  transferable later under the TII Succession Policy.

**G8 — Governance: PASS.** This is a genuine gate resolution, not a
relaxation of what PASS requires — every field the original audit and
`spec/governance-finalization.md` marked as blocking is now filled with an
explicit, human-confirmed value.

**This does not change any other gate, and does not move overall launch
status off NOT READY.** G3 (no key generated), G7 (domain approved and
registration authorized, but not yet actually registered), and G9
(submission conditionally authorized, blocked on the still-unregistered
domain and the specification URL/role email that depend on it) remain
CONDITIONAL PASS. **Production issuance remains DISABLED** — G8 resolving
authorizes nothing by itself; see `spec/human-decisions.md`'s Final
Approval Capture for exactly what was and was not authorized, and its
Execution plan for what remains to actually be done, by whom, before any
of it happens.

---

## G13 closure (appended 2026-09-12) — G13: CONDITIONAL PASS → PASS

The steward explicitly accepted the TII 1.0 Production Candidate release
artifact bundle (the table in §G13 above), in writing:

> "I explicitly accept the TII 1.0 Production Candidate release artifacts
> as the current release-candidate bundle."

With the scope of that acceptance stated explicitly by the steward and
preserved verbatim here — this acceptance:

- closes G13 as PASS;
- does **not** declare TII 1.0 final;
- does **not** authorize production TII issuance;
- does **not** authorize production key generation;
- does **not** itself execute domain registration or IANA submission.

**No artifact was regenerated, re-audited, or technically modified to
obtain this acceptance.** The one change made alongside it was the
administrative correction the steward separately authorized: the §G13
table's "Governance and Succession Policy" row, which still described
governance as "UNRESOLVED at legal-entity level" from before G8 resolved,
now reads "complete" with a note explaining the correction — a stale
cross-reference fix, not a reopening of any accepted content.

**G13 — Release artifacts: PASS.**

**This does not change G3, G7, or G9, and does not move overall launch
status off NOT READY.** Those three remain CONDITIONAL PASS for the
reasons already recorded above and in `spec/launch-status.json`.
**Production issuance remains DISABLED.**

---

## G7 closure (appended 2026-09-12) — G7: CONDITIONAL PASS → PASS

The steward changed the approved registrar from Cloudflare Registrar to
**Vercel Registrar** (superseding decision H — full reasoning and the
honest registrar/hosting-coupling trade-off this creates:
`spec/resolver-domain-decision.md` §15/§17), then purchased
`transition-ignition-id.org` themselves, directly, after Vercel's own CLI
explicitly refused to execute the purchase non-interactively
("Agents must not purchase domains on behalf of a user") — a third-party
platform safeguard against exactly the autonomous-agent-purchase pattern
this whole exchange had to navigate, respected rather than routed around.

**The completion report was independently verified, not taken on trust**,
via two separate sources agreeing: `vercel domains inspect` (authenticated
CLI) and a live RDAP query against the public registry
(`rdap.publicinterestregistry.org`, independent of Vercel). Both confirm
registration, matching nameservers, and matching dates. Full verification
detail — DNS resolution, HTTPS validity, every required public route
(`/`, `/registry`, `/spec`, `/audit`, `/about`, `/catalog.json`, `/ja`,
known/unknown/invalid `/tii/<token>`, and a confirmatory `/admin` 404),
the `TII_RESOLVER_BASE_URL` confirmation (via live `catalog.json` behavior
on both the new domain and the legacy `tiiarchive.vercel.app`, which
still works and correctly self-reports the new domain as its own resolver
base rather than claiming canonical status itself), and the identity
invariants (zero occurrences of the domain string in the ledger, ledger
byte-for-byte unchanged, the one identifier still `identifier_status:
"test"`) — all in `spec/resolver-domain-decision.md` §16.

**G7 — Permanent resolver: PASS.**

**This does not change G3 or G9, and does not move overall launch status
off NOT READY.** Both remain CONDITIONAL PASS. G9 specifically is now
one step closer — a stable `/spec` URL exists
(`https://transition-ignition-id.org/spec`) — but still requires role
email, the remaining IANA governance-field entry, and a fresh IANA
registry re-check immediately before any submission. **Production
issuance remains DISABLED** — domain registration authorizes no other
gate and mints nothing.

---

## G3 key ceremony executed, human action pending (appended 2026-09-12)

The human operator gave explicit authorization for production key
generation (J: NOT AUTHORIZED → AUTHORIZED). A ceremony then ran, reusing
the existing, unmodified `generateKeypair()`/`keyId()` from
`src/checkpoint.js` — no new key format invented, per §3/§10 of the
ceremony's own instructions.

**Generated and verified:** Ed25519 keypair, key identifier
`1b96b82d535afc95`. Signing test PASS, verification test PASS, all 4
tamper tests (altered head hash / event count / timestamp / body) correctly
rejected with `bad-signature`. All tests ran against a disposable test
ledger, deleted immediately after — the canonical ledger was never
touched. Generation happened on the operator's own persistent local
machine (confirmed non-ephemeral; FileVault full-disk encryption
confirmed On), never inside the public Vercel deployment, a static-build
environment, a browser, or any third-party service.

**A genuine, structural stop was hit at the encryption step — not a
formality.** This agent has no channel for hidden input: every command it
runs is visible in its own output, so it cannot itself type a passphrase
without that passphrase appearing in the transcript, and it was explicitly
instructed not to invent one. Per the ceremony's own rule, the raw
keypair was generated (no passphrase needed for that step), the plaintext
private key was written — restrictively permissioned, outside the git
repository entirely — and the agent **stopped**, handing the passphrase
entry and the offline-recovery-copy placement to the human operator, with
exact commands and a checksum to verify against. Full detail, including
the honest resolution of a real design tension (the operational copy must
stay plaintext-on-disk because the existing `resolveSigningKey()` has no
passphrase-decryption step and reading it unattended is required for
automated checkpoint signing — protected instead by filesystem permissions
plus confirmed FileVault disk encryption, while the recovery copy, which
is only ever human-mediated, is passphrase-encrypted):
`spec/production-key-custody.md` §8.

**No secret material was committed, logged, or exposed in chat.** A
secret-scan of the entire git-tracked repository found no PEM private-key
material (two prose mentions of the string "BEGIN PRIVATE KEY" in
existing audit documents, not actual key bytes) — now a permanent
regression test (`test/production-gate.test.js`, "G3 permanent
regression: no PEM private-key material...").

**G3 remains CONDITIONAL PASS** — per the ceremony's own acceptance
conditions, it becomes PASS only once the human confirms the independent,
separately-located encrypted recovery copy actually exists, which this
agent cannot itself perform or verify by proxy. **This does not change
G7, G8, G9, or G13, and does not move overall launch status off NOT
READY.** **Production issuance remains DISABLED** — key generation
authorizes no other gate and mints nothing; the software's own
`TII_PRODUCTION_ISSUANCE_ENABLED`/`TII_GOVERNANCE_APPROVED`/
`TII_RESOLVER_APPROVED` flags remain unset regardless.

---

## G3 custody audit correction (appended 2026-09-12, same day)

The paragraph immediately above described the operational copy as "a
plain PEM protected by filesystem permissions plus confirmed FileVault
disk encryption." **The steward caught that this does not satisfy the
approved model** ("encrypted private signing key available only to the
authoritative checkpoint process") — FileVault protects the disk at rest
while locked, but the key is a plaintext filesystem object the moment the
host is unlocked, which it must be for the authoritative writer to run at
all. Disk encryption and key encryption are not the same guarantee, and
this document should not have implied they were.

**Corrected, not silently redefined:**

- **Key `1b96b82d535afc95` is retired.** Ceremony/test key only — never
  promoted, never used for a real checkpoint (no `checkpoints/` directory
  ever existed in the repository while it was live). Its plaintext copy
  was securely overwritten and removed. Its public key and the non-secret
  sign/verify/tamper test results remain as audit evidence.
- **`src/checkpoint-store.js` `resolveSigningKey()` was extended** — the
  smallest change that satisfies the approved model — to accept a
  passphrase-encrypted PKCS8 PEM, decrypted via
  `TII_CHECKPOINT_KEY_PASSPHRASE`/`TII_CHECKPOINT_KEY_PASSPHRASE_FILE`,
  failing closed (returns `null`, never throws) on a missing or wrong
  passphrase. No change to Ed25519, JCS, key ID derivation, or the
  checkpoint format; every existing unencrypted test/disposable key still
  loads exactly as before. 7 new tests, all passing, alongside the full
  suite (185/185). Full detail: `spec/production-key-custody.md` §8.5.
- **No new production key was generated during this correction** — per
  the steward's own explicit instruction, generation under the corrected
  mechanism is deferred to a separately authorized ceremony.

**G3 remains CONDITIONAL PASS — unchanged status, corrected reasoning.**
This does not change G7, G8, G9, or G13, and does not move overall launch
status off NOT READY. **Production issuance remains DISABLED.**

## G3 final closure (appended 2026-09-13) — G3: CONDITIONAL PASS → PASS

The ceremony authorized after the correction above ran to completion,
entirely in the human operator's own terminal. Full detail:
`spec/production-key-custody.md` §8.7. Summary:

- A second candidate key, `46b11023f849e931`, was generated correctly
  (directly into encrypted PKCS8 form) but retired the same day — its
  human-chosen passphrase was only 9 bytes, insufficient for a long-lived
  production root key even though the *encryption mechanism itself* was
  correct this time (this was a passphrase-strength issue, not a repeat
  of the FileVault mistake above). Its private-key material (operational,
  a re-encrypted copy, and its USB recovery copy) was securely removed;
  only its non-secret public key remains as audit evidence.
- **The final production key is `1486de6152baec7f`** — Ed25519, generated
  directly into passphrase-encrypted PKCS8 form with a strong passphrase
  from first creation. No plaintext private-key file ever existed on
  disk. The agent independently re-derived its key ID from a copy of the
  public key (never trusting the human's report alone) and independently
  recomputed both the public-key SHA-256
  (`8712c17570beaacf079e4909e36b3762f1a1163e0e2575d84d3130b5a97e4311`) and
  the operational encrypted-key SHA-256
  (`ad7d345fae18530da94a40b525b2e27510a85c1ea7f889358ef18832a9679a45`)
  directly from the files on disk, both matching the human's report.
- A separately-located USB recovery copy was independently confirmed
  byte-identical (same SHA-256) by the agent reading the USB volume
  directly. A recovery rehearsal (both a full sign/verify/tamper test run
  against a disposable copy of the recovery file, and an independent
  OpenSSL-only public-key equivalence proof) confirmed the recovery copy
  reproduces the identical keypair.
- The full sign → checkpoint → verify → tamper-4/4-rejected cycle passed,
  run by the human against a disposable temp ledger only — the real
  `data/ledger.jsonl` was never opened by any ceremony test, confirmed
  unchanged throughout (10 events, same SHA-256 and head hash, before and
  after).
- No private-key or passphrase material exists in Git (permanent
  regression test, still passing) or in Vercel (independently checked via
  `vercel env ls` against the deployed `tiiarchive` project — the only
  variable present is the unrelated `TII_RESOLVER_BASE_URL`).
- Full test suite: 185/185 passing.

**Key `1486de6152baec7f` is ACTIVE FOR CHECKPOINT SIGNING. G3 Production
Key Custody: PASS.** This is a statement about checkpoint-signing
authority only — it does **not** enable production TII issuance, which
remains a separate, independently-gated condition and remains DISABLED.
This does not change G7, G8, G13 (all PASS, untouched) or G9 (still
CONDITIONAL PASS, untouched — no IANA submission occurred in this task).

**Remaining non-PASS launch gate: G9 only. Overall launch status remains
NOT READY** until G9 also resolves. **Production issuance remains
DISABLED.**

## G9 submission recorded (appended 2026-09-13) — G9: CONDITIONAL PASS → PENDING IANA

Prerequisites resolved first: the canonical public specification
(`https://transition-ignition-id.org/spec`) was extended with the
RFC 7595-required Fragment handling, Interoperability, Security, and
Privacy Considerations sections (the last citing
`spec/public-only-1.0.md`, no new normative rule), plus Change Controller
and Contact — independently re-fetched live and confirmed after
deployment. Contact/Change Controller were then corrected, per steward
decision, from a not-yet-operational custom-domain role mailbox to the
existing stable address: **Naoto Fujie `<platodesign@icloud.com>`** —
also independently re-verified live. A fresh IANA registry check,
immediately before preparing the submission, found `tii` still absent —
no conflict.

The human steward then submitted the provisional registration request
via the official form (`https://www.iana.org/form/protocol-assignment`):

```
Submission date:        2026-09-13
Requested scheme:       tii
Requested status:       Provisional
Registry:               Uniform Resource Identifier (URI) Schemes
Contact:                Naoto Fujie <platodesign@icloud.com>
Change Controller:      Naoto Fujie <platodesign@icloud.com>, operating publicly as P/A Institute
Specification:          https://transition-ignition-id.org/spec
IANA acknowledgment:    ACKNOWLEDGMENT PENDING
```

**Submission is not registration.** `tii` does not yet appear in the
official registry. **G9: PENDING IANA** — not PASS. G9 becomes PASS only
once the official IANA URI Schemes Registry is independently re-checked
and visibly contains `tii` under the expected Provisional status; an
acknowledgment, ticket, or confirmation email is not sufficient by
itself.

No ledger mutation, no identifier-syntax change, no production issuance.
G3, G7, G8, G13 untouched (all remain PASS).

**Remaining non-PASS launch gate: G9 (PENDING IANA). Overall launch
status remains NOT READY. Production issuance remains DISABLED.**

## Pre-G9 final launch audit (appended 2026-09-15) — G6, G14: PASS → CONDITIONAL PASS

A full audit of every gate not blocked on IANA, plus a first-production-
issuance rehearsal against entirely disposable state (its own temp
ledger, its own disposable Ed25519 key, never the real
`data/ledger.jsonl` — confirmed byte-identical before/after, SHA-256
`6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`),
found one genuine discrepancy between documentation and implementation.

**Finding:** `spec/first-production-issuance-procedure.md`'s "Recovery if
this procedure is interrupted mid-way" section, and this document's §G6,
both claim that retrying `issueProductionTII()` with the same
`idempotency_key` "returns the original result rather than minting a
second production identifier." **This is not what the code does.**
`issueProductionTII()` draws a fresh random candidate token on every
call — including a retry — and `Ledger._validateAppend()`'s idempotency
check requires the retried event's `tii` to match the original
(`src/ledger.js` line ~190: `existing.tii === partial.tii`). Since the
retry's randomly-generated candidate is never the same string as the
first attempt's, the check correctly finds a mismatch and throws
`idempotency_key "..." was already used for a different operation` —
**not** a silent duplicate, **not** data corruption, but also **not**
the graceful "same result returned" the documentation promises.

Proven directly, live, this phase (disposable state only):
```
Call 1: issueProductionTII(..., idempotency_key: "rehearsal-idem-1") -> tii:otrvymhoyotmrlpm2qtex2ziay, appended, checkpointed
Call 2: issueProductionTII(..., idempotency_key: "rehearsal-idem-1") -> THROWS "already used for a different operation"
        (expected per the existing docs: should have returned tii:otrvymhoyotmrlpm2qtex2ziay again, no new event)
```

**Severity: the safety property holds — no duplicate or corrupted
production identifier can ever result from a retry.** The gap is in the
*documented recovery contract*: an operator following
`spec/first-production-issuance-procedure.md` step 13's interruption
guidance literally, during the real (single, highest-stakes) production
issuance, would be told to "retry with the same idempotency_key" and
would instead receive a thrown error, unless they already knew to
instead search the ledger for the event carrying that idempotency_key.
This was caught by rehearsal specifically so it would not be discovered
for the first time during the real event.

**Corrected recovery guidance** (`spec/first-production-issuance-procedure.md`
was updated accordingly — see that file's own correction note): on an
interrupted step 13, do not blindly retry. First check whether an event
with the same `idempotency_key` already exists in the ledger (e.g. `tii
list` / a ledger scan for that key). If it does, that is the original,
successful result — use it, do not retry. If it does not, the append
never committed; retrying is safe (it will mint a genuinely new
candidate, as intended).

**Not fixed in code.** Changing `issueProductionTII()`'s behavior (e.g.
having it look up and return the existing event on this specific error)
would be a functional change to gated production-issuance code, out of
scope for an audit-and-rehearsal task — left for a separate, explicitly
authorized task.

**G6 — Recovery/idempotency: CONDITIONAL PASS.** The core mechanism
(`ledger.append()` idempotency with a caller-supplied, stable `tii`) is
proven correct and remains PASS-quality on its own. The composed
behavior through `issueProductionTII()` specifically does not match its
own documentation and is downgraded until either the code or the
documented contract is reconciled.

**G14 — First-issuance procedure: CONDITIONAL PASS.** The 22-step
procedure is otherwise sound and unchanged; its interruption-recovery
guidance has been corrected in place. Downgraded because the discovery
happened during audit, not before this document was first accepted as
PASS, and the correction should be reviewed before the real event relies
on it.

No ledger mutation, no identifier-syntax change, no production issuance,
no key rotation. G3, G7, G8, G13 untouched (all remain PASS) — not
reopened without evidence; G6 and G14 **were** reopened, specifically
because concrete new contradictory evidence was found, per this task's
own instruction.

**Remaining non-PASS launch gates: G6 (CONDITIONAL PASS), G9 (PENDING
IANA), G14 (CONDITIONAL PASS). Overall launch status remains NOT READY.
Production issuance remains DISABLED.**

## G6/G14 idempotency repair (appended 2026-09-15, same day) — G6, G14: CONDITIONAL PASS → PASS

**Root cause.** `issueProductionTII()` (`src/production-issuance.js`)
drew a fresh random candidate token on every call, including a retry —
so the ledger's idempotency check (`existing.tii === partial.tii`) never
matched on retry, and a same-key retry threw
`"already used for a different operation"` instead of returning the
original result. `Ledger.issueTII()` (the test path) already resolved
idempotent replay *before* drawing randomness; `issueProductionTII()`
never had the equivalent check.

**Fix.** Added `Ledger.findByIdempotencyKey(key)` (`src/ledger.js`) — a
pure, read-only lookup reusing the existing, already-durable
`_idempotency` map (rebuilt from the persisted `idempotency_key` field of
every event on every `load()`, not an in-memory-only cache; survives
process restart). `issueProductionTII()` now calls it **before** any
RNG, collision check, append, or checkpoint: if a match exists and its
`event_type` + `content` match what this call would produce, return that
persisted event immediately (no new candidate, no new event, no new
checkpoint); if a match exists with different content, fail closed with
an explicit conflict error; if no match, proceed exactly as before. A
second check in the retry loop's catch handler resolves the same-key
race case under real concurrency: if `ledger.append()`'s own
authoritative (post-writer-lock, post-resync) idempotency check rejects
a losing candidate because a concurrent caller's identical request
already won, that losing caller re-resolves by key and returns the
winner's result instead of propagating an error. No ledger schema
change; no new source of canonical truth; the smallest change that
closes the gap.

**Proof — 7 new permanent regression tests**
(`test/production-gate.test.js`): same key + same intent returns the
exact original result with zero new RNG calls, zero new events, zero new
checkpoints; replay survives a process restart (fresh `Ledger` instance);
same key + different intent fails closed; no key behaves ordinarily;
a genuine token collision on the first execution still retries correctly
alongside an idempotency key; retry after a failed checkpoint enters the
existing checkpoint-recovery path without minting a second identifier;
and a real multi-process concurrency test (8 concurrent OS processes,
same idempotency key) converges on exactly one canonical event and one
`tii`. Full suite: 192/192 passing (185 prior + 7 new), re-run three
times for confidence, zero flakiness.

**Proof — disposable end-to-end rehearsal**, exactly reproducing the
task's own required sequence: Call 1 (key K) → candidate X; Call 2 (same
K, same process) → returns X, no new RNG draw; process restart; Call 3
(same K, fresh `Ledger` instance) → returns X, still no new RNG draw
across all three calls (CSPRNG invoked exactly once, total). Verified
after: exactly one canonical `tii.issued` event, exactly one distinct
`tii`, ledger chain valid, checkpoint `VERIFIED` and
`matches_current_head: true`. The real repository ledger was confirmed
byte-identical before and after (SHA-256
`6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`) —
every step of this repair and its proof ran against disposable state
only.

**Documentation corrected**, not merely re-asserted:
`spec/first-production-issuance-procedure.md`'s interruption-recovery
section now describes the actual (fixed) behavior, states the exact
semantics ("an idempotency key identifies one logical issuance request;
a completed retry returns the original result; reuse for a different
request fails closed"), and explicitly declines to claim exactly-once
execution in the broader distributed-systems sense — the accurate,
narrower claim is durable idempotent replay for this project's
single-authoritative-writer model, which is what was actually proven.

**G6 — Recovery/idempotency: PASS.** Restart-safe idempotent replay is
proven; a retry after a checkpoint-recovery window does not duplicate
issuance; conflicting key reuse fails closed.

**G14 — First-issuance procedure: PASS.** The procedure's documented
retry guidance now matches actual, tested behavior; the isolated
first-issuance rehearsal passed end-to-end, including through a process
restart.

No ledger mutation, no identifier-syntax change, no production issuance,
no key rotation, no new IANA submission. G3, G7, G8, G9, G13 untouched.

**Remaining non-PASS launch gate: G9 (PENDING IANA) only. Overall launch
status remains NOT READY. Production issuance remains DISABLED.**
