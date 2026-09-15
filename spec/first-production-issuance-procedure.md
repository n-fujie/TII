# First Production TII Issuance — Procedure

> **This procedure is written to be followed. It has NOT been executed.**
> No step below was performed against the canonical ledger by this or any
> prior task. This document exists so that, once every launch gate in
> `spec/production-launch-gate.md` actually passes, the first production
> issuance is a checklist, not an improvisation.

## Preconditions

Do not begin step 1 until every gate in `spec/production-launch-gate.md`'s
final decision table reads **PASS** — not CONDITIONAL PASS, not UNRESOLVED.
A CONDITIONAL PASS gate must be resolved to a firm PASS first.

## The 22 steps

1. **Verify clean repository.** `git status` shows no uncommitted changes;
   `git log` HEAD matches the commit the launch-gate audit was performed
   against (re-run the audit if not).
2. **Verify canonical ledger.** `tii verify` (or `GET /status`
   `ledger_chain_integrity`) reports `VALID`; record the exact `head_hash`
   and `event_count`.
3. **Verify writer lock clear.** `GET /status` `writer_availability` reports
   `AVAILABLE` (not `LOCKED`, not `STALE_LOCK_PRESENT`, not `BLOCKED`).
4. **Verify recovery state clear.** `GET /status` `recovery_required` is
   `false`; `tii recover inspect` reports no malformed tail and no orphaned
   journal.
5. **Verify production identifier profile.** `node --test test/identifier.test.js`
   passes in full; the frozen profile in
   `spec/identifier-syntax-1.0-candidate.md` matches `src/identifier.js`
   byte-for-byte behaviorally (the test suite IS this check).
6. **Verify permanent resolver.** The approved domain (per
   `spec/resolver-domain-decision.md`'s final decision, actually purchased
   and DNS-configured under separate authorization) resolves over HTTPS;
   `TII_RESOLVER_BASE_URL` is set to it in the production deployment
   environment.
7. **Verify IANA status.** Re-check the IANA URI Schemes registry for `tii`
   one final time, immediately before this step. If registered by another
   party: **STOP** — do not proceed past this step under any circumstances.
   If a provisional registration was filed and accepted for this project:
   record its status. If not yet filed: confirm that launching production
   issuance without IANA registration is an explicitly accepted governance
   decision (it is not required by RFC 7595 for informal use, but the
   decision to proceed without it, or to have filed it, must be a recorded
   choice, not a silent omission).
8. **Verify governance approval.** The steward's legal-entity status
   (`spec/governance-candidate.md` §9, G8) is resolved to a firm, accurate
   legal name (or accepted as an unincorporated project under an explicit,
   recorded risk acceptance) — not left ambiguous. `TII_GOVERNANCE_APPROVED=true`
   is set only once this is true.
9. **Verify production signing key.** A production Ed25519 keypair exists
   per `spec/production-key-custody.md`'s procedure — generated,
   backed up to at least two independent locations, held by at least two
   accountable individuals — and `TII_CHECKPOINT_PRIVATE_KEY`/`_FILE` is
   configured in the production environment.
10. **Create a pre-issuance checkpoint.** `tii checkpoint create` against
    the current (pre-issuance) ledger state. This checkpoint attests
    "nothing has changed yet" and gives the production gate's
    `checkpoint_current` condition (`src/production-gate.js`) something
    current to check against.
11. **Explicitly enable the production gate.** Set
    `TII_PRODUCTION_ISSUANCE_ENABLED=true` (and
    `TII_RESOLVER_APPROVED=true`, `TII_IANA_GATE_SATISFIED=true` per steps
    6–7's outcomes) in the production deployment environment. Confirm via
    `tii production-status` that `available: true` and `blocked_by: []`.
12. **Authenticate the operator.** The individual performing this procedure
    authenticates with the admin token configured for the production
    deployment (`TII_ADMIN_TOKEN`) — this is the `admin_authenticated`
    condition `src/production-gate.js` deliberately leaves to the caller
    (see that module's doc comment); it must be checked here, explicitly,
    by whatever invokes step 13.
13. **Request one production identifier.** Invoke the gated issuance path —
    `tii issue --production --recorder <accountable operator identity>`
    (non-dry-run) — exactly once. Do not batch multiple requests.
14. **Uniqueness check under lock.** Handled automatically by
    `src/production-issuance.js` + `src/ledger.js`'s writer lock — no
    manual step; confirm the returned event's `tii` is the one actually
    appended (compare against `tii show <tii>`).
15. **Append the production issuance event.** Also automatic within step
    13; confirm here that `event.content.identifier_status === "production"`
    and that no test identifier was reused (`spec/production-launch-gate.md`
    §50 — `tii:h4r3jsn4p25d` must be unaffected, still `"test"`).
16. **fsync canonical ledger.** Automatic (`src/ledger.js` `append()`
    fsyncs the journal and the canonical file before returning) — confirm
    by re-running `tii verify` and observing the new `event_count`/`head_hash`.
17. **Create a signed checkpoint.** Automatic within `issueProductionTII()`
    (checkpoint-after-every-production-mutation policy, §16/§17 of
    `spec/production-launch-gate.md`) — confirm the returned
    `production_checkpoint.status === "CREATED"`. If it reports `"FAILED"`,
    **stop here** — do not proceed to step 18; the mutation is already
    committed (do not roll it back), but treat this as a launch incident:
    diagnose the signing failure, restore checkpoint currency
    (`tii checkpoint create`), and only then continue.
18. **Verify checkpoint.** `tii checkpoint verify` reports `status: VERIFIED`
    and `matches_current_head: true` against the freshly-appended head.
19. **Build public projection.** `tii rebuild-static <outDir>` (or redeploy
    the running server, which serves the resolution page directly) and
    confirm the new identifier's resolution page renders correctly, in both
    languages, with `identifier_status: production` visible.
20. **Verify resolver.** Fetch `https://<permanent-domain>/tii/<new-token>`
    over the live, deployed resolver and confirm it returns the expected
    record — the same discipline as
    `spec/phase1-adversarial-verification.md` §18's live-deployment check,
    now against the real production identifier.
21. **Disable issuance again, if the initial launch policy is
    one-at-a-time.** Set `TII_PRODUCTION_ISSUANCE_ENABLED=false` (or remove
    it) in the production environment immediately after step 20 succeeds,
    unless the steward has explicitly decided on a different initial
    cadence. Confirm via `tii production-status` that `available: false`
    again.
22. **Archive the launch report.** Record, in a durable, non-secret
    location: the exact identifier issued, the exact event, the checkpoint
    file (or its hash + location), the operator who performed the
    procedure, the timestamp, the exact commit hash of the code that
    performed it, and the outcome of every step above. This report becomes
    part of future succession-manifest updates
    (`spec/succession-manifest.md`).

## What this procedure deliberately does not include

- **No ontology dump.** Per `spec/production-launch-gate.md` §43, the first
  production record requires only `recorder` (SPEC.md's one required
  field) and whatever minimal content the operator chooses to note — no
  state, transition, ignition, domain, lineage, owner, or document-type
  fields are required, and none should be added merely for ceremony.
- **No self-certifying claims.** Per §44, the issuance event and any
  announcement of it must not assert that TII is universally authoritative,
  supersedes DOI/ARK, proves truth, proves ownership, guarantees
  permanence, or establishes metaphysical identity. See
  `spec/production-release-claims.md` for the full allowed/forbidden
  language audit.

## Recovery if this procedure is interrupted mid-way

Every step from 13 onward that touches the ledger is protected by the same
crash-safety machinery verified in
`spec/phase1-adversarial-verification.md` §8/§9 — a malformed tail or an
orphaned journal is always detected, never silently accepted; stop and run
`tii recover inspect` before any retry if either is present, exactly as
for any other write — see `spec/crash-recovery.md`.

**CORRECTED 2026-09-15 (pre-G9 final launch audit — see
`spec/production-launch-gate.md`'s "Pre-G9 final launch audit" note for
the full finding).** This section previously said an interruption after
step 13 could be recovered by "retrying step 13 with the same
`idempotency_key`... which returns the original result." **That is not
what `issueProductionTII()` does, and following that instruction
literally will fail.** `issueProductionTII()` generates a fresh random
candidate token on every call, including a retry; the ledger's
idempotency check requires the retried event's `tii` to match the
original exactly, so a retry's new random candidate never matches and
the retry throws `idempotency_key "..." was already used for a different
operation` — safely (no duplicate is ever created), but not gracefully.

**If step 13 is interrupted (no response observed):**

1. **Do not immediately retry.** First check whether the original attempt
   actually committed: search the ledger for an event carrying the same
   `idempotency_key` used in step 13 (e.g. scan `data/ledger.jsonl` for
   that key, or use `tii show <tii>` if the candidate is somehow known).
2. **If a matching event is found:** that is the real, successful result
   of step 13. Use its `tii` — do not retry, do not treat this as
   incomplete. Continue to step 14 using that identifier.
3. **If no matching event is found:** the append never committed (or was
   rolled back by the writer lock / recovery machinery before completing).
   Retrying step 13 is safe — it will mint a genuinely new, different
   candidate, exactly as a fresh first attempt would.
4. This gap — `issueProductionTII()`'s idempotency_key not providing a
   graceful same-result retry, unlike the general `ledger.append()` path
   used elsewhere — was discovered by direct rehearsal against disposable
   state before this procedure was ever run for real, specifically so it
   would not be discovered mid-event. A future task may close this gap in
   code (e.g. having `issueProductionTII()` look up and return the
   existing event on this specific error); until then, follow steps 1–3
   above.
