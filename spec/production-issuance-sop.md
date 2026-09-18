# Production TII Issuance — Standard Operating Procedure

> Distilled from the successfully completed, independently verified
> first production issuance
> (`tii:fabdi3ifjwteyi3os2hwmx2l5i`, tag
> [`tii-first-production-issuance-2026-09-17`](https://github.com/n-fujie/TII/releases/tag/tii-first-production-issuance-2026-09-17),
> commit `2306df1`). This SOP describes the process that was actually
> run and verified — it does not introduce new steps, relax any
> condition, or change the production gate, ledger, or identifier
> semantics. Full narrative detail lives in
> `spec/production-issuance-authorization-record.md`,
> `spec/first-production-issuance-runbook-reviewed.md`, and
> `spec/first-production-issuance-procedure.md`; this document is the
> short, repeatable checklist distilled from them.

## Five distinct activities (do not conflate these)

1. **Verification** — read-only confirmation that a *past* issuance is
   exactly what it claims to be
   (`node scripts/verify-first-production-issuance.js`; evidence record at
   `spec/verification/first-production-issuance-2026-09-17.{json,md}`).
   Proves nothing about the future.
2. **Preflight** — read-only confirmation that the repository is
   currently *healthy enough for a human to begin reviewing* a possible
   *future* issuance (`node scripts/preflight-production-issuance.js`,
   optionally with `--idempotency-key <proposed-key>`). **PREFLIGHT PASSED
   does not mean ISSUANCE AUTHORIZED** — it establishes only that the
   repository is in a state suitable for human review. It does not
   authorize or execute production issuance, and it is structurally
   incapable of doing so (it never imports `src/production-issuance.js`,
   never sets any `TII_*` variable, never touches the passphrase).
3. **Review/authorization** — the human decision, in writing, naming the
   exact commit and the exact new issuance
   (`spec/production-issuance-authorization-record.md`'s pattern). Neither
   verification nor a passing preflight is itself a review or an
   authorization.
4. **Ephemeral human execution** — the actual issuance, run only by the
   steward, in the subshell pattern below. Never performed by the agent.
5. **Independent post-execution verification** — the agent re-derives
   every claim from disk after the steward reports the (non-secret)
   result, exactly as this SOP's step 5 describes; this is what eventually
   produces a new verification record like the one for the first
   issuance.

These are five separate steps for a reason: a clean preflight on Tuesday
does not carry over to Thursday, a verification record for issuance #1
says nothing about the safety of issuing #2, and no combination of
verification and preflight ever substitutes for the human review in step
3 or the fresh authorization it requires.

## Roles

- **Steward/operator** (human, holds the production passphrase): runs
  every command that touches the real signing key. Never types the
  passphrase anywhere the agent can observe it.
- **Agent** (this assistant): prepares commands, verifies results
  independently, never requests or handles the passphrase, never runs a
  command that would need it.

## Preconditions (all must already be true)

- All 14 launch gates PASS (`spec/launch-status.json`).
- Explicit human authorization recorded for the specific commit under
  review (`spec/production-issuance-authorization-record.md`'s pattern).
- A unique, purpose-labeled idempotency key chosen for this issuance —
  never reused across different issuances.
- The exact recorder identity and note content reviewed and approved in
  advance, in writing, before any command runs.

## The procedure

0. **Run the preflight** (agent or steward, read-only):
   `node scripts/preflight-production-issuance.js --idempotency-key
   <proposed-key>`. A failing preflight stops here — fix the reported
   condition and re-run. A passing preflight only means the repository is
   ready for the human review in step 2; it is not itself that review and
   does not shortcut it.
1. **Capture the pre-issuance baseline** (agent, read-only): ledger
   SHA-256, event count, head hash, identifier count and list, current
   checkpoint's independent verification (public key only).
2. **Prepare the reviewed runbook** (agent): exact command, exact
   proposed content object, exact idempotency key — presented for human
   approval before anything runs. Stop and wait.
3. **Human approves and executes**, in their own terminal only, using
   the ephemeral-subshell pattern:
   - `umask 077`, hidden passphrase read (`stty -echo` / `read -s`),
     written to a `mktemp` file, chmod 600.
   - `trap cleanup EXIT INT TERM HUP` unsetting every `TII_*` variable
     and removing the passphrase file, so an interrupt still cleans up.
   - Export the four policy flags
     (`TII_PRODUCTION_ISSUANCE_ENABLED`, `TII_GOVERNANCE_APPROVED`,
     `TII_RESOLVER_APPROVED`, `TII_IANA_GATE_SATISFIED`) plus
     `TII_CHECKPOINT_PRIVATE_KEY_FILE` (the real key) and
     `TII_CHECKPOINT_KEY_PASSPHRASE_FILE` (the temp file) — all inside
     one subshell `( ... )`, never the parent shell.
   - `node bin/tii.js production-status` — confirm `available: true`,
     `blocked_by: []`, **before** proceeding.
   - `node bin/tii.js issue --production --recorder <identity> --note
     <text> --idempotency-key <key>` — the issuance itself.
   - Passphrase file removed, subshell exits, every `TII_*` variable
     gone with it.
4. **Human reports the non-secret JSON output** (issuance result,
   checkpoint result) back to the agent.
5. **Agent independently verifies**, never trusting the report alone:
   - Ledger: event count exactly +1, exactly one new `tii.issued`,
     `prev_hash` equals the former head, new head hash as expected,
     `verify().ok === true`, diff shows a pure single-line append.
   - Checkpoint: `checkpoint verify` (public key only) →
     `VERIFIED`, correct `key_id`, `matches_current_head: true`.
   - Rebuild all projections (atomic build); new identifier appears
     exactly once in catalog and per-identifier files.
   - CLI `show`/`events`, including a fragment-bearing form.
   - Dynamic resolver (path route, `/resolve` bare and fragment forms,
     `/catalog.json`).
   - The actual static build's own shipped client script (not a
     reimplementation), via the same `vm`-execution technique used
     throughout this project's test suite.
   - Commit the ledger change, deploy, and verify the **live** deployed
     resolver and catalog.
   - **Idempotent replay**: human re-runs the identical command (same
     key, same content) through the same ephemeral mechanism; agent
     confirms the ledger is byte-identical before/after — the necessary
     and sufficient proof of a correct replay, since the agent cannot
     observe the command's own `idempotent_replay` field without the
     passphrase.
   - Fresh process, no `TII_*` variables: `production-status` reports
     `available: false` again.
   - Full test suite passes.
6. **Record and tag**: append the completion record to
   `spec/production-issuance-authorization-record.md`, commit
   separately from the issuance commit, then create an annotated tag
   pointing at that exact completion commit
   (`tii-first-production-issuance-<date>` pattern) and push it.
7. **Publish a standalone verification record**: add
   `spec/verification/<event-name>-<date>.{json,md}` following the shape
   of `spec/verification/first-production-issuance-2026-09-17.{json,md}`
   (public, non-secret facts only: commits, tag, ledger fingerprint,
   checkpoint fingerprints, test result, explicit "evidence only, no
   authorization" statement), then confirm
   `node scripts/verify-first-production-issuance.js` — or its
   equivalent for the new event, if a separate script is warranted —
   still exits 0.

## Non-negotiable invariants (do not relax these)

- The agent never sees, requests, types, or stores the production
  passphrase — not in chat, not in a command it runs, not in a file it
  writes.
- The production gate is satisfied **ephemerally**, in a subshell, never
  persisted to committed configuration, a deployment's environment
  variables, or anywhere else that would survive the shell exiting.
  `computeGateStatus(...)` against the committed repository
  configuration must always read `available: false`
  (`test/production-gate.test.js`'s permanent regression test).
- Every claim is independently re-derived by the agent from the actual
  files/ledger/checkpoints — never taken on trust from a report, however
  detailed.
- A pure append to `data/ledger.jsonl` is the only acceptable ledger
  change; the diff must show zero modification to any prior line.
- Idempotency keys are unique per logical issuance and never reused for
  a different one.
- Documentation-only commits (recording decisions, verification results)
  do not require re-review of the executable state, provided they touch
  none of: executable code, runtime configuration, ledger contents,
  identifier semantics, issuance logic, gate conditions. Any commit that
  does touch one of those invalidates a prior authorization and requires
  a fresh review against the new commit.

## What this SOP does not authorize

Following this SOP for a **second** issuance requires its own fresh
authorization cycle — a new reviewed runbook, a new explicit human
authorization statement naming the new event, and a new unique
idempotency key. Nothing here pre-authorizes any future issuance; each
one is reviewed and approved on its own.

A passing run of `scripts/preflight-production-issuance.js` is not an
exception to this: it is a health check on the repository, not a review
of the specific issuance, and it never itself sets any gate condition or
touches the passphrase. Likewise, the existence of a verification record
for a past issuance does not extend, imply, or pre-clear authorization
for any future one.
