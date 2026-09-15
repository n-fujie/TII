# Post-IANA Enablement Runbook

> **Not executed. Prepared 2026-09-15, ahead of IANA's response, per the
> pre-G9 final launch audit.** This bridges "IANA responds" to the
> already-written `spec/first-production-issuance-procedure.md`'s own
> Preconditions. It does not duplicate that document's 22 steps and does
> not replace them.

## Preconditions for starting this runbook

IANA has responded to the provisional `tii` URI scheme submission
recorded in `spec/iana-provisional-registration.md` (submitted
2026-09-13). Do not start step 1 merely because time has passed, an
acknowledgment email arrived, or a ticket/reference number exists —
those are not registration.

## The 8 steps

1. **Independently verify the IANA registry entry.** Fetch
   `https://www.iana.org/assignments/uri-schemes/uri-schemes.xhtml` live
   and confirm it contains an entry for `tii` with `Status: Provisional`.
   An acknowledgment email is a prompt to check, never a substitute for
   checking. If `tii` is absent, or present under different terms than
   requested (different status, different registrant), **stop** — do not
   proceed, and record the discrepancy.
2. **Record G9 = PASS.** Only after step 1 succeeds. Update
   `spec/production-launch-gate.md`'s Final Decision Table, the
   `gates.G9_iana` field and a new `re_verifications` entry in
   `spec/launch-status.json`, and append a closure note to
   `spec/human-decisions.md`, following this project's existing
   append-only convention (correct/extend, never silently rewrite prior
   entries).
3. **Re-run minimal post-IANA invariant checks.** Not a full re-audit —
   confirm the four facts most likely to have drifted since the pre-G9
   audit: (a) canonical ledger unchanged (event count, head hash, SHA-256
   of `data/ledger.jsonl`); (b) full test suite still passing; (c) the
   live resolver (`https://transition-ignition-id.org`) still serves
   `/`, `/spec`, `/registry`, `/audit`, `/catalog.json` at 200; (d) no
   gate other than G9 has silently changed status.
4. **Present the final launch status to the human.** All fourteen gates,
   their current status, and the overall launch status — in the same
   format this project has used throughout (see any "FINAL REPORT"
   section of the recent audit phases). Do not characterize the system as
   launched, ready-to-launch, or safe to launch in this presentation —
   only state the gate table as it now reads.
5. **Obtain explicit human authorization to enable production issuance.**
   A recommendation from this agent is never itself an authorization
   (`spec/human-decisions.md`'s standing rule). Wait for an explicit,
   separate instruction naming production issuance specifically — the
   same standard already applied to every other irreversible action in
   this project (domain purchase, key generation, IANA submission).
6. **Only then set the required runtime governance/resolver/launch
   approvals.** In the production deployment environment (not this local
   checkout): `TII_GOVERNANCE_APPROVED=true`, `TII_RESOLVER_APPROVED=true`,
   `TII_IANA_GATE_SATISFIED=true`, and the production signing key env vars
   (`TII_CHECKPOINT_PRIVATE_KEY_FILE` + passphrase mechanism) pointing at
   the real key (`1486de6152baec7f`) — never `TII_PRODUCTION_ISSUANCE_ENABLED`
   yet; that is step 11 of the 22-step procedure, deliberately later than
   the other flags so a partial configuration can never accidentally open
   the gate.
7. **Verify the gate opens.** `tii production-status` (or
   `computeGateStatus()` directly) reports `available: true`,
   `blocked_by: []`, against the real production configuration — not a
   disposable rehearsal environment this time.
8. **Issue the first production TII only under separate explicit
   authorization**, following `spec/first-production-issuance-procedure.md`
   steps 11 onward exactly, including its corrected interruption-recovery
   guidance (§"Recovery if this procedure is interrupted mid-way",
   corrected 2026-09-15) and `spec/first-production-tii-plan.md`'s content
   decisions. Do not treat completing steps 1–7 above as authorization
   for step 8 — they are preparation, not permission.

## What this runbook does not do

It does not itself check the IANA registry, does not itself set any
environment variable, does not itself request or assume human
authorization, and does not itself issue anything. It exists so that,
when G9 resolves, the response is a checklist, not an improvisation —
exactly the stated purpose of `spec/first-production-issuance-procedure.md`,
extended one layer earlier.
