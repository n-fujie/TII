# TII External Infrastructure Closure — G7 / G8 / G9 / G3

**Date:** 2026-09-11. **Commit at start of this phase:** `b28b4e0`. This
phase closes the *external/operational* launch gates — resolver, governance,
IANA, and key custody — to the point where **only explicit human
authorization remains** for each. It does not touch the identifier
profile, the writer/recovery machinery, or the security posture
established in prior phases, and it does not issue anything.

## §0 — Correcting one audit phrase

The prior phase's `spec/production-launch-gate.md` and
`test/production-gate.test.js` described the one test that exercises the
non-dry-run branch of `issueProductionTII()` using phrasing that could be
misread as claiming a production TII was created. **Corrected in this
phase:**

- `test/production-gate.test.js`: the test's title and surrounding
  comments now read **"production-path integration test (isolated
  disposable ledger)"** and explicitly state the minted value is an
  **"ephemeral generated identifier"** — never a production TII, never
  part of the canonical registry, never reserved in the production
  namespace, never publicly resolved, never promoted.
- `spec/production-launch-gate.md` §49: updated to say "a production-path
  integration test against an isolated disposable ledger," matching.
- **New regression assertion added** to that same test: it now reads the
  real `data/ledger.jsonl` from disk and asserts the ephemeral identifier
  minted during the test does **not** appear anywhere in it — a direct,
  executable check that the disposable fixture never leaked into the
  canonical registry, not just a documentation claim.
- Checked (and confirmed accurate, no change needed): `src/production-
  issuance.js`'s doc comment ("...without any risk of a real production
  identifier being minted") and `spec/first-production-issuance-
  procedure.md`'s step 20 ("...now against the real production
  identifier") both already refer correctly to a genuine *future*
  production identifier once the procedure is actually executed, not to
  anything created by testing — left as-is.

**The canonical ledger was not altered to make this correction** — this
was a test/documentation wording and assertion change only.
`test/production-gate.test.js` re-run after the change: 28/28 passing.

## Baseline (recorded before this phase's work)

| Item | Value |
|---|---|
| git commit | `b28b4e0` |
| Full test count | 175 |
| `data/ledger.jsonl` md5 | `fb56b2a4a2f5fe134f3fa23e2186e7d1` |
| Event count | 10 |
| Head hash | `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95` |
| `verify()` | `{ ok: true, problems: [] }` |
| Identifiers | `tii:h4r3jsn4p25d` — `identifier_status: "test"`, the only one |
| Production issuance | DISABLED (gate closed against the real repo — reconfirmed) |
| `launch-status.json` (prior) | `overall_launch_status: "NOT_READY"`; G3/G7/G9 CONDITIONAL PASS, G8 UNRESOLVED |
| G1–G14 (prior) | 9 PASS, 4 CONDITIONAL PASS (G3, G7, G9, G13), 1 UNRESOLVED (G8) |

Confirmed: all historical identifiers test-only; production issuance
disabled; no domain canonical; no IANA registration submitted; no
production private signing key exists.

## G7 — Permanent resolver: closed to "ready pending authorization"

Live RDAP re-check performed this phase (method validated against
`iana.org` as a live control, returning full registration data with no
`errorCode`): **both `transition-ignition-id.org` and `tii-id.org`
confirmed available** (`errorCode: 404` from Public Interest Registry's
RDAP service, not a network failure or ambiguous result — reported as
CONFIRMED, not UNKNOWN).

Full re-audited comparison (availability, pricing, registrar, transfer,
DNSSEC, registrar lock, WHOIS/RDAP behavior, account recovery/2FA/
hardware-key support, DNS portability, hosting portability, spelling
stability, conceptual durability, trademark exposure, institutional
neutrality): `spec/resolver-domain-decision.md` §14.

- **FINAL RECOMMENDED DOMAIN: `transition-ignition-id.org`.**
- **FALLBACK DOMAIN: `tii-id.org`** (conditional on an unperformed
  trademark clearance search).
- **RECOMMENDED REGISTRAR: Cloudflare Registrar** (at-cost pricing, full
  DNSSEC, hardware-key/WebAuthn account 2FA — chosen on security and
  predictability grounds, not lowest price).
- Domain authorization packet, DNS plan, and resolver-configuration
  reconfirmation: `spec/resolver-domain-decision.md` §14.4–§14.6.

**No domain purchased. No DNS changed.** G7 remains **CONDITIONAL PASS**.

## G8 — Governance: roles separated, human input form issued

`spec/governance-finalization.md` (new) separates seven roles (public
steward / legal entity / IANA contact / IANA change controller /
signing-key custodian / hosting operator / registrar controller), presents
two non-inventive legal-identity models (A: individual Change Controller,
B: organization Change Controller with P/A Institute as operating name),
and issues a human-input form marking each field REQUIRED BEFORE IANA,
REQUIRED BEFORE PRODUCTION, or OPTIONAL.

**No legal identity or named contact was inferred from the repository,
GitHub identity, domain data, or branding.** Two fields remain genuinely
open: the legal person/entity name and relationship to "P/A Institute,"
and the IANA named contact — both require a human decision this task
cannot responsibly make.

**G8 remains UNRESOLVED.**

## G9 — IANA: technical fields finalized, registry reconfirmed clear

Fresh, independent IANA URI Schemes registry check this phase: **`tii`
still absent** — no registered, provisional, or historical entry. **No
STOP condition.** Every technical field in
`spec/iana-provisional-registration.md` is complete (scheme syntax,
semantics, encoding, fragment handling, interoperability, resolution
behavior, security considerations, examples — all sourced from the frozen
TII Identifier Syntax 1.0). Only three genuinely governance-dependent
fields remain open: Contact, Change Controller, Specification URL — all
three explicitly traced to G7/G8 above, not guessed.

An IANA submission authorization packet (`spec/iana-provisional-
registration.md` "IANA submission authorization packet") reports draft
completeness as **INCOMPLETE** on governance fields and **COMPLETE** on
technical fields, with an explicit `SUBMIT / DO NOT SUBMIT` decision left
to a human.

**Not submitted.** G9 remains **CONDITIONAL PASS** — does not become PASS
until the `tii` scheme actually appears in the IANA registry under the
intended registration.

## G3 — Production signing-key custody: model fully specified, no key generated

`spec/production-key-custody.md` extended with: a storage-option
comparison (encrypted offline file / encrypted removable backup / OS
secret store / managed KMS-HSM), a recommendation (the two-copy
operational+offline model, HSM explicitly not required "merely for
appearance" at current scale), a precise 10-step key-generation ceremony
(clean environment → generate → derive key id → encrypt → offline backup
→ publish public key → verify → checkpoint-test against a **disposable**
ledger → destroy temporary plaintext → custody record), a key-loss model
(distinct from compromise — table of what survives / what stops / what
requires an explicit, non-silent key-transition record), and a
re-confirmation that the signing-failure production policy (§17 of the
prior phase) still passes its test unchanged.

**No production key was generated by this task.** G3 remains
**CONDITIONAL PASS**.

## Release claims — re-audited, unchanged

`spec/production-release-claims.md` (from the prior phase) was re-checked
against the current public surfaces (`SPEC.md`, `ABOUT.md`, their `.ja`
counterparts, `src/views.js`, `README.md`) for every forbidden term listed
in this phase's §37 (immutable, tamper-proof, unforgeable, decentralized
issuance, privacy-preserving, independently timestamped, truth-verifying,
ownership-proof, universally authoritative). **Zero matches, confirmed
again this phase** — no regression, no change required. New governance
language added by this phase (`spec/governance-finalization.md` §8, the
public About-page answers) was checked against the same list before being
written — none of the forbidden terms appear there either.

## Action order (recommended, not executed)

1. Approve governance identity (`spec/governance-finalization.md` §3/§6).
2. Approve the permanent domain (`spec/resolver-domain-decision.md` §14.4).
3. Register the domain (human action — not performed by this task).
4. Configure DNS/HTTPS (`spec/resolver-domain-decision.md` §14.5).
5. Create role email addresses (`spec/governance-finalization.md` §7).
6. Publish the stable specification URL under the new domain.
7. Generate and secure the production signing key
   (`spec/production-key-custody.md` §7.4).
8. Complete the IANA package (fill the three open fields in
   `spec/iana-provisional-registration.md`).
9. Re-check the IANA registry one final time, immediately before
   submission.
10. Explicitly authorize IANA submission (the authorization packet in
    `spec/iana-provisional-registration.md`).
11. Wait for / verify the IANA provisional registration actually appears.
12. Re-run the full G1–G14 audit (`spec/production-launch-gate.md`).
13. Only then, separately, request production-launch authorization
    (`spec/first-production-issuance-procedure.md`).

**This phase performed none of steps 1–13.** Each remains a future,
separately authorized action.

## HUMAN DECISIONS REQUIRED

Only decisions that cannot responsibly be inferred by this task:

- **A. Approve final permanent domain** — `transition-ignition-id.org`
  (recommended) or `tii-id.org` (conditional on trademark clearance) or
  neither.
- **B. Approve registrar** — Cloudflare Registrar (recommended) or an
  alternative from `spec/resolver-domain-decision.md` §14.3.
- **C. Provide/approve legal or individual Change Controller identity** —
  Model A (named individual) or Model B (organization, with P/A Institute
  as operating name if legally accurate) —
  `spec/governance-finalization.md` §3.
- **D. Provide/approve named IANA Contact** — a specific, accountable
  person.
- **E. Approve role email arrangement** — `standards@`/`security@`/
  `registry@` at the approved domain, once it exists.
- **F. Approve production key-custody model** — the two-copy model
  recommended in `spec/production-key-custody.md` §7.2/§7.3, or an
  alternative.
- **G. Authorize domain registration** — the irreversible purchase step.
- **H. Authorize production key generation** — the irreversible
  key-creation step.
- **I. Authorize IANA submission** — the irreversible registration-request
  step.

No other decision in this phase's scope is outstanding — everything else
(technical readiness of G1/G2/G4/G5/G6/G10/G11/G12, the domain/registrar/
key-storage comparisons, the IANA draft's technical fields) is already
settled and requires no further human input to remain correct.

## Final Closure Table

| Gate | Current status | Technical work complete? | Human decision required? | External action required? | Exact remaining blocker | Next irreversible action |
|---|---|---|---|---|---|---|
| **G3** Key custody | CONDITIONAL PASS | Yes — model, ceremony, loss model, storage comparison all specified and where testable, verified | Yes — F, H | No (generation can happen offline, no vendor dependency required) | No production key exists | Generate the production key per the documented ceremony |
| **G7** Resolver | CONDITIONAL PASS | Yes — domain/registrar/DNS decision fully frozen with one recommendation each | Yes — A, B, G | Yes — domain registration itself | No domain purchased | Register `transition-ignition-id.org` via Cloudflare Registrar |
| **G8** Governance | UNRESOLVED | No — cannot be completed by code/documentation alone | Yes — C, D | No | Legal entity identity and IANA contact both genuinely unknown to this task | A human states the legal/individual identity |
| **G9** IANA | CONDITIONAL PASS | Yes — every technical field complete, registry reconfirmed clear | Yes — I (and depends on C/D/A resolving first) | Yes — the submission itself, and waiting for IANA to process it | 3 governance-dependent fields open (Contact, Change Controller, Spec URL) | Submit the provisional registration once G7/G8 resolve |

**No gate is marked PASS prematurely.** Every CONDITIONAL PASS above
became so this phase only by having its remaining blocker narrowed to a
named human decision or an already-authorized-pending external action —
never by relaxing what PASS itself requires.

## Non-mutation confirmations

- No domain purchased.
- No DNS changed.
- No role mailbox created.
- No IANA submission sent.
- No production private key generated.
- No production TII issued.
- No test identifier promoted.
- Canonical ledger unchanged (confirmed identical md5/head-hash/event-count
  before and after this phase — see Final Report).
- Production issuance disabled (confirmed: gate closed against the real
  repository both before and after this phase's changes).

## What this phase does not convert into TII identity (restated, per the task's own closing principle)

The permanent domain locates records — it is not the identifier. The
Change Controller administers a specification — it is not the identifier.
The signing key authenticates checkpoints — it is not the identifier. The
registrar maintains a domain registration — it is not the identifier. The
current steward coordinates the system — it is not the identifier. The
identifier remains `tii:<token>`. **Production issuance remains DISABLED
until a later, explicit launch authorization.**

---

## Re-verification log

This phase's closure was re-run in full and found complete on first
execution. A subsequent request repeated the same phase verbatim; rather
than duplicate the documents above (which would add no new information and
risk drifting from this file's own internal cross-references), each
re-run is logged here with fresh evidence for the two genuinely
time-sensitive checks — domain availability and IANA registry state —
which are the only facts in this closure capable of silently going stale.
Nothing else in this document changes between re-runs unless one of these
checks comes back different.

| Re-run date | RDAP: `transition-ignition-id.org` | RDAP: `tii-id.org` | RDAP method control | IANA `tii` check |
|---|---|---|---|---|
| 2026-09-11 (original) | Available (404) | Available (404) | `iana.org` → live registration data | Absent — clear |
| 2026-09-11 (re-run, same day) | Available (404) | Available (404) | `iana.org` → live registration data | Absent — clear |

**No change in any external fact between runs.** No STOP condition
triggered on either check. All statuses, recommendations, and the Final
Closure Table above are unchanged and reconfirmed current as of the most
recent row.
