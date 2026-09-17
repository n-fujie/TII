# TII Production Issuance — Authorization Record

> **This document does not authorize production issuance.** It exists so
> that an explicit, separate human decision can be made against a fixed,
> fully-referenced state of the repository. Production issuance remains
> DISABLED. No identifier has been issued under this record.

## Executable state under review vs. this record's own commit

**The executable/code state under review is commit `c809909`.**

```
c809909  Fix issueTII() idempotency content check; found by a live end-to-end rehearsal
```

This record was itself added in a separate, later commit,
**`1d7312a`**. That commit adds only this document — it does not change
executable behavior, identifier semantics, ledger state, gate state, or
production-issuance availability. `c809909` remains the exact executable
state a human authorization decision would apply to; `1d7312a` (and this
amendment) are part of the authorization *process*, not part of what is
being authorized.

**Documentation-only commits that merely record the authorization
process do not invalidate the reviewed executable state**, provided they
do not modify:
- executable code,
- configuration affecting runtime behavior,
- ledger contents,
- identifier semantics,
- issuance logic, or
- gate conditions.

`1d7312a` and this amendment satisfy that condition — confirmed below by
re-running the full suite and re-verifying the ledger and gate state
after each.

**Any subsequent commit that DOES touch one of those six categories
invalidates this authorization and requires a new review** against the
new commit — this record is not transferable to a different executable
state by inference, and a documentation commit does not extend it to
cover a later code change either.

## What is being referenced (completed, not repeated here)

| Gate / audit | Status | Reference |
|---|---|---|
| All 14 launch gates (G1–G14) | **PASS** | `spec/production-launch-gate.md`, `spec/launch-status.json` |
| IANA provisional registration | **Registered** — `tii`, Provisional, CRI Scheme Number 1027, registered 2026-09-15 | `spec/iana-provisional-registration.md`; independently confirmed live at `https://www.iana.org/assignments/uri-schemes/prov/tii` |
| IANA conformance audit | Fragment-handling non-conformance found (dynamic resolver and, separately, the deployed static site's client script) and fixed; both now conform to the registered scheme text | `spec/iana-conformance-audit-2026-09-17.md` |
| Duplicated-implementation audit | Three independently drifted reimplementations of TII reference interpretation found and consolidated into one shared primitive (`src/tii-lookup.js`) | `spec/duplicated-implementations-audit-2026-09-17.md` |
| Issuance-path audit | Full generation → collision → persistence → registry/catalog → resolver → recovery trace; static-build rebuild made atomic; ledger-level collision/concurrency proofs added for the general issuance path | `spec/issuance-path-audit-2026-09-19.md` |
| Controlled issuance rehearsal | Live end-to-end rehearsal using real code paths; found and fixed a genuine idempotency-content-comparison defect in `issueTII()`; reconstruction-from-ledger-alone proven | `spec/rehearsal-audit-2026-09-17.md` |
| Production key custody | Key `1486de6152baec7f` (Ed25519, passphrase-encrypted PKCS8) — **ACTIVE FOR CHECKPOINT SIGNING** | `spec/production-key-custody.md` §8.7 |
| Governance | Naoto Fujie, operating publicly as P/A Institute — Change Controller and Contact | `spec/human-decisions.md`, `spec/governance-finalization.md` |

None of the above is re-derived, re-summarized, or re-verified in this
document — it is a pointer to already-completed, already-committed work.

## The governing invariant

**The canonical ledger (`data/ledger.jsonl`) is the sole record of
authority.** Every other artifact this system produces or serves —
`catalog.json`, per-identifier JSON/HTML pages, the registry page, the
dynamic resolver's responses, the deployed static mirror itself — is a
**reconstructible projection** of the ledger, never an independent
source of fact. This was not merely asserted; it was demonstrated:
`spec/rehearsal-audit-2026-09-17.md` deleted every derived artifact and
rebuilt the entire site from `data/ledger.jsonl` alone, byte-identical
except the wall-clock rebuild timestamp. This invariant does not change
if production issuance is later authorized — a production identifier
would be one more line in the same ledger, subject to the same
projection model, not a parallel or privileged record.

## Known residual risks (carried forward, not resolved here)

These are documented in the audits above; listed here only as pointers,
not re-argued:

1. **Static-build atomic swap has one narrow window.** Replacing an
   *existing* build directory requires two renames (POSIX cannot swap two
   existing directories atomically in one syscall); a crash exactly
   between them leaves the output directory transiently absent, though
   the previous build is always recoverable from a `.stale-*` sibling,
   never lost. (`spec/issuance-path-audit-2026-09-19.md` §3.4)
2. **`issueTII()`/`append()` are deliberately non-idempotent without a
   caller-supplied `idempotency_key`.** By design; callers needing
   retry-safety must supply one. (`spec/issuance-path-audit-2026-09-19.md`
   §3.3, demonstrated again in `spec/rehearsal-audit-2026-09-17.md`)
3. **A hard process kill during a rebuild can leave an orphaned
   `<outDir>.building-*` temp directory on disk.** Disk-hygiene only —
   never in the served path, never a correctness risk.
   (`spec/issuance-path-audit-2026-09-19.md` §3.4)
4. **Only two of three trust layers are implemented**: internal chain
   integrity and signed-checkpoint authenticity. Independent third-party
   timestamping is explicitly not implemented — TII must never be
   described as independently timestamped, tamper-proof, or immutable.
   (`spec/phase1-adversarial-verification.md`, carried forward unchanged
   since the original adversarial-verification phase)
5. **The signing-key custody model is single-operator.** The operational
   and offline-recovery copies of the production key are both controlled
   by the same individual — acceptable at TII's current pre-production,
   single-steward scale per its own stated framing, not yet a
   multi-party custody arrangement. (`spec/succession-manifest.md` §12)

## What this record does NOT do

- It does not set `TII_PRODUCTION_ISSUANCE_ENABLED` or any other
  production-gate runtime flag.
- It does not issue a production identifier, test or otherwise.
- It does not introduce a new launch-gate condition, a new trust claim,
  or a new terminology.
- It does not redesign the identifier scheme, the ledger, the resolver,
  or the custody model.
- It does not itself constitute authorization — only an explicit,
  separate human decision naming production issuance specifically does,
  per the standing rule already established in `spec/human-decisions.md`
  ("a recommendation from this agent is never itself an authorization")
  and the sequence already laid out in
  `spec/post-iana-enablement-runbook.md` steps 4–8.

## Verification performed while preparing this record

- Full test suite: **242/242 passing**.
- Canonical ledger: **byte-identical** before and after —
  `data/ledger.jsonl`, 10 events, SHA-256
  `6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`,
  `verify().ok === true`, head hash
  `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`.
- Production gate: confirmed still closed —
  `computeGateStatus(...).available === false`, blocked by
  `production_requested`, `governance_approved`, `resolver_approved`,
  `iana_gate_satisfied`, `signing_ready`, `checkpoint_current` — none of
  which is set in the committed configuration.

### Re-verified after the procedural clarification amendment

The amendment above (distinguishing the reviewed executable state,
`c809909`, from this record's own documentation commits) touched only
this file. Re-ran the same verification afterward:

- Full test suite: **242/242 passing**.
- Canonical ledger: **byte-identical**, same SHA-256
  (`6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`)
  and head hash
  (`eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`)
  as above, `verify().ok === true`.
- Production gate: confirmed still closed —
  `computeGateStatus(...).available === false`, same six blocking
  conditions as above, unchanged.

This confirms the amendment is itself a documentation-only commit under
the rule stated above: it does not touch executable code, runtime
configuration, ledger contents, identifier semantics, issuance logic, or
gate conditions, and therefore does not invalidate `c809909` as the
executable state under review.

**Stopping here, before any change to the production gate**, per this
task's explicit instruction.

## Human authorization decision (2026-09-17)

The following explicit human authorization was given and is recorded
here verbatim, append-only:

> "I authorize production issuance of TII identifiers against the
> reviewed executable state at commit c809909, subject to the
> production gate conditions, the residual risks recorded in
> spec/production-issuance-authorization-record.md, and the invariant
> that the canonical ledger remains the sole record of authority."

**What this decision does:** it is the human authorization step this
record existed to receive — the "explicit, separate human decision
naming production issuance specifically" referenced above, applied to
the executable state at `c809909` (see "Executable state under review
vs. this record's own commit" above; documentation-only commits added
after `c809909`, including this one, do not change that executable
state per the rule stated there).

**What this decision does NOT do**, per its own explicit wording and per
this task's instruction:

- It does not itself set `TII_PRODUCTION_ISSUANCE_ENABLED` or any other
  production-gate runtime flag — the authorization is explicitly
  "subject to the production gate conditions," which remain unmet in the
  committed configuration (`production_requested`, `governance_approved`,
  `resolver_approved`, `iana_gate_satisfied`, `signing_ready`,
  `checkpoint_current`).
- It does not issue any identifier, production or otherwise.
- It does not modify executable code, runtime configuration, ledger
  contents, identifier semantics, issuance logic, or gate conditions —
  confirmed by the verification immediately below.
- It does not waive or resolve the residual risks listed above — the
  authorization is explicitly "subject to" them, not a decision that
  they no longer apply.
- It does not change the governing invariant — the canonical ledger
  remains the sole record of authority, and the decision explicitly
  says so itself.

**Next step, not taken here:** per
`spec/post-iana-enablement-runbook.md` steps 6–8, actually enabling
issuance requires a further, separate operational action — setting the
runtime governance/resolver/signing/production flags in the deployment
environment and verifying the gate opens against that real
configuration — which this decision authorizes but does not itself
perform.

### Verified after recording this decision

- Full test suite: **242/242 passing**.
- Canonical ledger: **byte-identical** — `data/ledger.jsonl`, 10 events,
  SHA-256 `6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`,
  head hash `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`,
  `verify().ok === true` — unchanged from every prior check in this
  record.
- Production issuance: **confirmed still unavailable** —
  `computeGateStatus(...).available === false`, blocked by the same six
  conditions (`production_requested`, `governance_approved`,
  `resolver_approved`, `iana_gate_satisfied`, `signing_ready`,
  `checkpoint_current`), none of which this decision set.

This entry records the human decision only. No executable code, runtime
configuration, ledger content, identifier semantics, issuance logic, or
gate condition was modified in recording it.

## Production-gate activation rehearsal (2026-09-17)

Following the authorization above, the production gate was rehearsed
open using the existing mechanism only — no code, config, ledger
content, identifier semantics, or gate logic was changed to do this.

**What happened, in the human operator's own terminal:** the four
policy flags (`TII_PRODUCTION_ISSUANCE_ENABLED`, `TII_GOVERNANCE_APPROVED`,
`TII_RESOLVER_APPROVED`, `TII_IANA_GATE_SATISFIED`) were exported, the
real production key was pointed to via `TII_CHECKPOINT_PRIVATE_KEY_FILE`,
and the passphrase was supplied via `TII_CHECKPOINT_KEY_PASSPHRASE_FILE`
pointing at a temporary file the operator created and deleted themselves
— never seen, typed, or held by this agent at any point. `tii checkpoint
create` produced a real signed checkpoint against the real ledger head;
`tii production-status`, run in that same shell, reported
**`available: true`**, all nine conditions true, `blocked_by: []`. Shell
cleanup left no `TII_*` variables behind.

**Independently verified by this agent, without ever touching the
passphrase** (the checkpoint's signature needs only its embedded public
key to verify, never the private key or passphrase):

- `checkpoints/checkpoint-0000000010-...json` exists.
- `tii checkpoint verify` → `status: VERIFIED`, `key_id: 1486de6152baec7f`
  (the known production key), `matches_current_head: true`,
  `ledger_head_hash: eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`
  — exactly the real ledger's current head.
- Canonical ledger: **byte-identical** — `data/ledger.jsonl`, 10 events,
  SHA-256 `6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd`,
  `verify().ok === true` — unchanged from every prior check in this
  record.
- **No `tii.issued` event was added** — exactly one remains
  (`tii:h4r3jsn4p25d`, the pre-existing historical test identifier); no
  identifier, test or production, was issued as a side effect of any of
  this.
- This agent's own shell: no `TII_*` variable present at any point
  (it never held the passphrase to begin with).
- **Re-ran `tii production-status` in a genuinely fresh process with no
  environment variables set at all**: `available: false`, the same six
  conditions blocking again, exit code 1 — including `checkpoint_current`,
  which reports false here even though the checkpoint above is real and
  valid, because that condition (as coded) only evaluates once
  `signing_ready` is also true *in the same evaluation*; it is not a
  stored or cached fact.

### The distinction this rehearsal establishes

1. **Verified**: the production gate genuinely opens — all nine
   conditions, including the two that require the real signing key and
   passphrase — when every authorized runtime condition is actually
   supplied together, in one process. This was not a simulation or a
   mocked key; it was the real production key (`1486de6152baec7f`) and a
   real signed checkpoint against the real ledger head.
2. **Not done**: persistent production-issuance enablement. Nothing was
   changed in the committed repository, in any deployment's environment
   variables, or anywhere else that would make the gate open again on
   the next process invocation. The enabling environment was exported in
   one interactive shell for the duration of two commands and ceased to
   exist the moment that shell's variables were gone — confirmed above
   by re-checking in a fresh process. The permanent regression test
   already in this codebase ("the committed repository configuration
   ... never satisfies the gate") remains true and was not touched.

**Production issuance remains DISABLED in every persistent sense.** This
rehearsal proves the mechanism works exactly as designed — fail-closed
without the real secret, genuinely open only with it, and open for
exactly as long as that secret is actually present and no longer.
Actually issuing the first production identifier remains a separate,
not-yet-taken step (`spec/first-production-issuance-procedure.md`), and
this rehearsal did not perform it.

## First production issuance — completion record (2026-09-17)

The step described as "not-yet-taken" immediately above has now been
taken, using exactly the mechanism just rehearsed. Full detail:
`spec/first-production-issuance-runbook-reviewed.md` (the reviewed
runbook and proposed object, approved before execution).

```
tii:                 tii:fabdi3ifjwteyi3os2hwmx2l5i
event_id:            evt_bfrbdmdd6sprept3
seq:                 10
recorder:            Naoto Fujie
idempotency_key:     tii-first-production-issuance-2026-09-17
prev_hash:           eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95 (former head)
hash / new head:     398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc
Executed:            git commit 419de8f
```

Independently verified across the issuance and the subsequent
idempotent-replay retry (both requiring the real production passphrase,
supplied only by the human operator in their own terminal — never seen
by this agent):

- Ledger: exactly 11 events, exactly one new `tii.issued` event, exactly
  the identifier above, `prev_hash` equal to the former head,
  `verify().ok === true`. Byte-identical before and after the idempotent
  replay (SHA-256
  `34e415cbf63a721ee6aa5ea34907cbf095f67e526ddc401923d09037737fd664`,
  same head hash, both re-checked directly against the file).
- Both checkpoints created for the new head, plus the pre-existing one
  for the former head: all three independently **VERIFIED** against the
  public key alone, `key_id: 1486de6152baec7f` — never re-derived from
  or dependent on the passphrase.
- Registry/catalog, per-identifier projections, CLI (`show`/`events`,
  including fragment-bearing references), the dynamic resolver, the
  actual static build's own shipped client script, and the **live
  deployed resolver** (`https://transition-ignition-id.org`, after a
  real deploy) all independently confirmed to serve the new identifier
  correctly and consistently.
- **Idempotent replay**: re-running the identical issuance command (same
  idempotency key, same content) through the real production path added
  no new event, created no new checkpoint, and returned the same
  identifier — inferred with certainty from the ledger's own
  unchanged state (event count, SHA-256, head hash, and `tii.issued`
  count all identical before and after), which is the necessary and
  sufficient on-disk consequence of a correct idempotent replay; this
  agent did not independently observe the command's own
  `idempotent_replay: true` field, since running that command requires
  the passphrase.
- Fresh process, no `TII_*` variables: `production-status` reports
  `available: false` again, the same six conditions blocking as before
  any of this began.
- Full test suite: **242/242 passing**, including the corrected
  historical invariant in `test/ledger-integrity.test.js`
  (`spec/production-issuance-authorization-record.md`'s sibling
  clarification commit, `38fcdd4`) that now explicitly recognizes this
  exact event as the authorized first production issuance rather than
  treating it as a violation.
- The version-semantics question raised during initial verification
  (checkpoint `spec_version` vs. the note's "TII 1.0") was investigated
  and resolved as a documentation gap, not a real inconsistency — two
  independently-versioned specifications, now explicitly cross-referenced
  in both directions (`SPEC.md`, `spec/identifier-syntax-1.0-candidate.md`,
  `spec/checkpoint-operation.md`, commit `38fcdd4`). No code, ledger, or
  checkpoint field was renamed or reinterpreted to resolve it.

**First production TII issuance: COMPLETE.** `tii:fabdi3ifjwteyi3os2hwmx2l5i`
is the one production identifier in the canonical ledger. No second
production issuance has occurred or was performed as part of any of this
verification. Production issuance capability remains gated exactly as
designed — closed by default, opening only when the real passphrase is
supplied in an ephemeral, human-controlled environment, and closing
again the instant that environment ends.
