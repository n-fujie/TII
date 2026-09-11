# Production Release Claims Audit

Audits all public-facing language TII uses about itself, per
`spec/production-launch-gate.md` §45–§47. This is a discipline document: it
does not change any code; it states what may and may not be claimed, and
checks the current public surfaces (`SPEC.md`, `ABOUT.md`, `src/views.js`,
`spec/*.md`) against that list.

## 1. Allowed claims (verified true of the current system)

| Claim | Verified by |
|---|---|
| Append-only historical recording | `src/ledger.js` `append()` — no update/delete path exists anywhere in the codebase |
| Revisable descriptions | SPEC.md §5 (supersedes), `test/capability-regression.test.js` |
| Public reconstruction from an export alone | `spec/capability-boundary-audit.md` §32, `spec/production-launch-gate.md` §G12 |
| Signed checkpoints (Ed25519 + RFC 8785 JCS) | `spec/checkpoint-operation.md`, `src/checkpoint.js` |
| Single-writer canonical operation | `spec/single-writer-model.md`, re-verified `spec/production-launch-gate.md` §G5 |
| Hosting independence | `spec/resolver-domain-decision.md` §7, `spec/phase1-adversarial-verification.md` §17/§18 |
| Explicit limitations, stated plainly | this entire spec series — every audit document lists what is NOT true alongside what is |

## 2. Forbidden claims (unless independently established — none of these are, today)

| Forbidden term | Why it is forbidden right now | What would be required to earn it |
|---|---|---|
| **immutable** | The canonical ledger is a plain file on a filesystem an operator with write access can edit; `verify()` alone cannot detect a full-chain rewrite (`spec/capability-boundary-audit.md` §26) | Would require, at minimum, widely-distributed independent mirrors that would visibly disagree on any rewrite — not implemented |
| **unforgeable** | A checkpoint is forgeable by anyone holding the signing key (`spec/phase1-adversarial-verification.md` §1 Scenario C) — this is inherent to any key-based scheme, not a defect, but it means "unforgeable" is false without qualification | Would require an independent witness/transparency log that does not trust any single key alone |
| **permanent** | No resolver, hosting provider, or organization is claimed permanent — only the *identifier string* persists in the sense that it is never reused or reassigned (`spec/succession-policy.md` §0) | Use "the identifier is never reused or reassigned," not "permanent" |
| **decentralized** | TII 1.0 is explicitly single-authoritative-writer (`spec/single-writer-model.md`) — the opposite of decentralized | Would require an actual multi-writer consensus design, explicitly out of scope |
| **distributed issuance** | Same as above | Same as above |
| **privacy-preserving** | TII 1.0 is public-only by design (`spec/public-only-1.0.md`) — every field of every event is public on every surface | Would require an actual privacy/redaction subsystem, explicitly not implemented (`spec/public-only-1.0.md` §"What restricted-disclosure handling would require") |
| **tamper-proof** | Localized tampering is *detectable* (`verify()`), not *prevented* — the file can still be edited; detection ≠ prevention | Use "tamper-evident," never "tamper-proof" |
| **independently timestamped** | No RFC 3161 TSA, transparency log, or third-party witness exists (`spec/production-key-custody.md` §6, `spec/phase1-adversarial-verification.md` L2/L3) | Would require actually deploying one of those mechanisms |
| **globally authoritative** | TII makes no claim of exclusivity or universal recognition; "TII" the abbreviation is itself contested (`spec/resolver-domain-decision.md` §5 — Technology Innovation Institute) | Not a code property — a claim discipline; never assert this |
| **ownership-proof** | The core has no owner field; relations are recorded, not adjudicated (SPEC.md, `spec/capability-boundary-audit.md` §16) | TII structurally cannot make this claim — it would contradict the data model itself |
| **truth-verifying** | TII records what was asserted and by whom; it never evaluates whether an assertion is true | Same as above — structurally out of scope for what TII is |

**Current public surfaces checked (2026-09-11):** `SPEC.md`, `ABOUT.md`,
`SPEC.ja.md`, `ABOUT.ja.md`, `src/views.js` (`homePage`, `auditPage`,
`resolutionPage`), `README.md` — none of the forbidden terms above appear
in any of them as an affirmative claim about the system. `SPEC.md` and the
Audit page explicitly state the *opposite* of several (e.g. "does NOT by
itself prove the history was never fully rewritten," "not privacy-safe").
No regression found; no change required by this audit.

## 3. Straw-man / comparative claim audit (§47)

Where TII's own documentation discusses other identifier systems:

- `spec/freeze-audit.md` and `spec/identifier-syntax-1.0-candidate.md`
  compare TII's identifier syntax against **UUIDv4** on purely technical
  grounds (collision math, encoding, canonical form) — not on
  aesthetic/philosophical grounds (a prior correction already applied in an
  earlier phase; see the freeze-audit's revision history). No claim that
  UUIDv4 "lacks" a capability it actually has.
- References to **DOI, ARK, Handle** appear in
  `spec/capability-boundary-audit.md` §19 (external identifiers module) and
  `spec/identifier-syntax-1.0-candidate.md` (references section) — always
  in the form "TII does not resolve or validate a recorded DOI/ARK; it is
  the recorder's assertion," which is an accurate statement about what TII
  itself does, not a claim about what DOI/ARK/Handle can or cannot do.
  These systems are never described as inferior, and TII never claims to
  supersede or replace them.
- No reference to **UUID, DID, IPFS** as competitors anywhere in the
  current spec series makes a capability claim about those systems at all
  — they are not discussed comparatively beyond the UUIDv4 technical
  comparison above.
- **Finding: no straw-man comparison exists in the current documentation.**
  This section exists as a standing check for future documentation changes,
  not because one was found and corrected here.

## 4. Theoretical regression audit (§46)

Checked that the Production Launch Gate phase's own changes (the gated
production issuance path, `src/production-gate.js`,
`src/production-issuance.js`) do not reintroduce any of the following.
**None found:**

| Concern | Reintroduced? | Why not |
|---|---|---|
| Fixed object identity | No | `issueProductionTII()` mints an opaque 128-bit token; no object/essence field exists anywhere in its code path |
| Permanent ownership | No | No `owner` field in `content` anywhere in `src/production-issuance.js` or the frozen syntax spec |
| Mandatory state | No | Only `recorder` is required (inherited from `Ledger.append()`'s existing required-field check, unchanged) |
| Mandatory transition | No | Same as above |
| Mandatory ignition | No | Same as above |
| Mandatory lineage | No | Same as above |
| Fixed address as identity | No | The production path has no address/resolver-base parameter in the token generation itself (`src/identifier.js` `generateIdentifier()` takes no arguments) |
| Domain as identity | No | Same — `resolutionUrl()` takes the domain as a parameter, never embeds it |
| Steward as identity | No | `recorder` on a production event is data, exactly like a test event; `src/production-gate.js`'s `governance_approved` flag gates *whether issuance may occur*, never becomes part of the identifier |
| Signing key as identity | No | `spec/production-key-custody.md` §1/§5 — rotation changes no TII; the gate's `signing_ready`/`checkpoint_current` conditions gate *issuance timing*, never identity |
| Resolver as identity | No | Same principle as domain, above |
| Permanent institutional authority | No | `governance_approved` is a boolean flag an operator sets after a governance decision is made; it is re-evaluated on every gate check, not baked into anything issued |

## 5. First production record content discipline (§43/§44, restated)

`spec/first-production-issuance-procedure.md` step 13 requires only
`recorder` and operator-chosen minimal content — no state, transition,
ignition, domain, lineage, owner, or document-type field. The event content
and any public announcement of the first production issuance MUST NOT
assert TII is universally authoritative, supersedes DOI/ARK, proves truth,
proves ownership, guarantees permanence, or establishes metaphysical
identity (§1–§2 above apply identically to that specific event's language,
not just to the specification documents).
