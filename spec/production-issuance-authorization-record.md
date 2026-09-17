# TII Production Issuance — Authorization Record

> **This document does not authorize production issuance.** It exists so
> that an explicit, separate human decision can be made against a fixed,
> fully-referenced state of the repository. Production issuance remains
> DISABLED. No identifier has been issued under this record.

## Commit being authorized

```
c809909  Fix issueTII() idempotency content check; found by a live end-to-end rehearsal
```

This is `HEAD` of `main` at the time this record was created. If any
further commit lands before a human authorization decision is made, this
record must be re-issued against the new commit — it is not
transferable to a different commit by inference.

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

**Stopping here, before any change to the production gate**, per this
task's explicit instruction.
