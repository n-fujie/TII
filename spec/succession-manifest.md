# TII Succession Manifest

> Non-secret. Contains **no private key material**, no credentials, no admin
> tokens. Everything below is either already public, or is a pointer to
> where a public thing lives, or is an explicit statement that an item does
> not yet exist because production has not launched. This manifest
> operationalizes `spec/succession-policy.md` §1 ("what must always be
> exportable") into a concrete, current checklist — see that document for
> the policy and procedure this manifest supports.

## 1. Specification location

- **Source repository (current):** `https://github.com/n-fujie/TII` —
  contains the full specification (`SPEC.md`, `SPEC.ja.md`), all `spec/*.md`
  documents, the complete zero-dependency implementation (`src/`, `bin/`),
  and the full test suite (`test/`).
- **Permanent specification URL:** **NOT YET ESTABLISHED** — depends on the
  permanent resolver domain (G7, UNRESOLVED — see
  `spec/production-launch-gate.md`). Until then, the source repository is
  the interim canonical location for the specification text.
- **Live deployment (read-only mirror, not canonical):**
  `https://tiiarchive.vercel.app` — a static export only; see §2.

## 2. Canonical ledger format

- **Format:** append-only JSON Lines (JSONL), one event object per line, UTF-8,
  documented normatively in `SPEC.md` and `spec/identifier-syntax-1.0-candidate.md`.
- **Current canonical file:** `data/ledger.jsonl` in the source repository —
  **10 events, 1 identifier (`tii:h4r3jsn4p25d`, `identifier_status: "test"`)**
  as of this manifest's date (2026-09-11). This file itself IS the succession
  artifact for the ledger — no database, no proprietary export format.
- **Reconstruction:** `node bin/tii.js rebuild-static <outDir>` reproduces
  the full public site (all identifiers, all languages, all exports) from
  `ledger.jsonl` alone, with zero external dependencies, zero network
  access, and zero hosting-provider-specific code — demonstrated
  repeatedly in `test/capability-regression.test.js` and
  `spec/production-launch-gate.md` §G12.

## 3. Latest known checkpoint

- **Status: NONE EXIST.** No signed checkpoint has ever been created against
  the committed canonical ledger — production issuance is disabled, no
  production signing key has been generated (`spec/production-key-custody.md`),
  and checkpoint creation was only ever exercised in this project's automated
  tests, against disposable throwaway ledgers that are discarded when the
  test process exits.
- **When one exists:** it will be a portable JSON file under `checkpoints/`
  (gitignored — never committed; see `spec/checkpoint-operation.md`), named
  `checkpoint-<event_count>-<timestamp>-<nonce>.json`, and MUST be
  independently retained (copied off the host that produced it) by more
  than one steward representative the moment it is created — a checkpoint
  retained only on the same host as the ledger provides no protection
  against a compromise of that host (`spec/phase1-adversarial-verification.md`
  L3).

## 4. Public verification keys

- **Status: NONE EXIST.** No production signing keypair has been generated
  (`spec/production-key-custody.md` §4 — key generation is documented, not
  executed).
- **When one exists:** the public key is self-embedded in every checkpoint
  file it signs, and is additionally recorded (public key only, never the
  private key) in `checkpoints/keyset.json` alongside its `key_id` and
  validity window. Both — the keyset file and independently retained
  checkpoint files — should be included in any future update to this
  manifest.

## 5. Resolver-domain operational dependencies

- **Permanent domain:** not registered. Two candidates cleared for
  availability as of 2026-09-11 (`spec/resolver-domain-decision.md`, and the
  same-day live RDAP re-check in `spec/production-launch-gate.md` §G7):
  `transition-ignition-id.org` (brand-safety primary) and `tii-id.org`
  (secondary, conditional on a trademark clearance search not yet
  performed).
- **Current interim endpoint:** `tiiarchive.vercel.app`, a Vercel static
  deployment. **Not canonical, not identity-bearing** — the identifier
  contains no hostname (`spec/identifier-syntax-1.0-candidate.md` §9); this
  endpoint is replaceable at any time by redeploying the static export
  anywhere and does not need to be preserved for succession.
- **Configuration dependency:** exactly one environment variable,
  `TII_RESOLVER_BASE_URL`, controls the resolver base everywhere in the
  codebase (`spec/resolver-domain-decision.md` §7). A successor needs only
  to set this variable and redeploy — no code change.

## 6. Registrar recovery requirements

- **Status: NOT APPLICABLE YET** — no domain has been purchased, so there is
  no registrar account to recover. When a domain is purchased (under
  separate, explicit authorization — not by this or any prior task), this
  section must be updated with: the registrar, the account-recovery path,
  auto-renewal status, and at least two independent steward representatives
  holding recovery access (per `spec/resolver-domain-decision.md` §11).

## 7. IANA change-controller procedure

- **Status: NOT SUBMITTED** — no IANA registration exists yet for the `tii`
  URI scheme (re-confirmed absent, most recently 2026-09-11 — see
  `spec/iana-provisional-registration.md`'s G9 re-check and
  `spec/production-launch-gate.md` §G9).
- **When registered:** a change of change-controller is filed as an IANA
  registry update (a `mailto:iana@iana.org` request per RFC 7595, from the
  then-current, IANA-recognized contact) plus a recorded
  `stewardship.transferred` ledger event — see `spec/governance-candidate.md`
  §2 and §5, and `spec/succession-policy.md` §3.

## 8. Source-code location

- `https://github.com/n-fujie/TII`, branch `main`. Zero runtime
  dependencies (`package.json` declares none) — the entire system runs on
  a stock Node.js installation with no `npm install` required for the
  application code itself (only `node --test` for the dev-only test
  runner, which ships with Node).

## 9. Rebuild instructions

```bash
git clone https://github.com/n-fujie/TII
cd TII
node bin/tii.js verify                    # confirm chain integrity of data/ledger.jsonl
node bin/tii.js rebuild-static ./public   # reproduce the full public site
node --test                               # run the full test suite (see spec/production-launch-gate.md for the current count)
```

No database, no build step beyond the above, no cloud service, no
credentials required for any of the above three commands. A successor with
only this repository (or just `data/ledger.jsonl` plus the source tree) can
reproduce the complete public registry state.

## 10. What this manifest does NOT establish

Per `spec/phase1-adversarial-verification.md`'s complete-operator-loss
analysis (carried forward) and `spec/production-launch-gate.md` §G12/§38,
this manifest establishes **reconstructable identity and history**. It does
**not** by itself establish:

- **authority credentials** — who is entitled to act as the next steward is
  a governance decision (`spec/governance-candidate.md`, currently
  UNRESOLVED at the legal-entity level), not something this manifest can
  grant;
- **domain continuity** — a lost/expired domain requires a new registration
  and, unavoidably, a period where the old resolver URL does not work, even
  though the identifiers and history are never lost;
- **signing-key custody continuity** — if every copy of a production
  signing key were lost (not merely compromised), no NEW checkpoint could
  ever again be attested by that key; a successor would need to rotate to
  a new key and would be unable to produce backdated signatures under the
  old one (which is the correct, safe outcome — see
  `spec/production-key-custody.md` §6).

These four things — reconstructable identity/history, authority
credentials, domain continuity, and signing-key custody — are kept
explicitly separate here and must never be conflated when this manifest is
updated in the future.

## 11. Operational roles — the six questions (External Infrastructure Closure, 2026-09-11)

| Question | Current answer |
|---|---|
| Who controls the domain? | **Nobody yet — no domain is registered** (`spec/resolver-domain-decision.md` §14). Once registered, this must be filled in with the registrant/controller from `spec/governance-finalization.md` §6. |
| Who can transfer the domain? | Same as above — not yet applicable. |
| Who controls IANA Change Controller updates? | **Nobody yet — nothing is registered with IANA.** Once registered, the accountable party is whoever `spec/governance-finalization.md` §3/§6 resolves to (Model A individual or Model B entity). |
| Who controls the public specification? | The current steward (P/A Institute, candidate — `spec/governance-candidate.md`), via the source repository (`https://github.com/n-fujie/TII`). |
| Who holds the signing key? | **Nobody — no production signing key exists** (`spec/production-key-custody.md`). |
| Who holds the offline key backup? | Not applicable — see above. |

Every row above reading "nobody yet" is an honest statement of current
state, not a gap in this manifest — see
`spec/production-launch-gate.md`'s Final Closure Table for exactly what
remains before each can be filled in.

## 12. Bus-factor audit (qualitative)

Per this phase's explicit instruction: **do not falsely claim
institutional resilience where one person currently controls everything.**
At TII's current, pre-production scale, one-person operation is honestly
what exists, and that is acceptable **only if documented honestly and
recovery material is kept separated** (never collapsed into a single
account/credential/location).

| Asset | Current single point of failure? | Why / mitigation status |
|---|---|---|
| Registrar credentials | N/A — no registrar account exists yet | When created: must not be the sole credential holder's only account recovery path — `spec/resolver-domain-decision.md` §14.3 recommends hardware-key (WebAuthn/FIDO2) 2FA specifically to raise the bar on this single point |
| DNS | N/A — no DNS configured yet | Tied to the registrar/DNS-provider account above until otherwise separated |
| Git repository (source + specification) | **Yes, currently** — hosted at `github.com/n-fujie/TII`, a single GitHub account | Mitigated by full local clonability (`spec/succession-manifest.md` §9) — the repository's *content* survives even if the *hosting account* does not, but the ability to push further official commits does not, until a second maintainer or an organizational account is established |
| Signing private key (operational copy) | N/A — does not exist yet | When generated: single-copy-in-one-place is exactly what §7.3 of `spec/production-key-custody.md` explicitly forbids |
| Signing private key (offline backup) | N/A — does not exist yet | Must be a **different** person/account/vendor than the operational copy, per `spec/production-key-custody.md` §7.3 |
| IANA contact | N/A — not yet named | A role-email forwarding address (§7 above) reduces this once a domain exists, but IANA's actual contact-of-record is a named person, which is inherently one accountable individual at a time |
| Change Controller | N/A — not yet resolved (Model A or B) | Model B (organization) spreads this across an entity's account-holders rather than one individual, at the cost of the entity needing to genuinely exist — see `spec/governance-finalization.md` §3 |
| Domain email (role addresses) | N/A — not created | Same account-separation discipline as the registrar row applies once created |
| Ledger source (`data/ledger.jsonl`) | **No** — fully reconstructable from any repository clone; no single point of failure once more than one clone exists (which is already true: this repository, any contributor's local clone, and the GitHub-hosted copy) |
| Checkpoint copies | N/A — none exist yet | Once they do: must be retained in more than one location per `spec/checkpoint-operation.md` and `spec/phase1-adversarial-verification.md` L3 — a checkpoint held only where the ledger also lives protects against nothing |

**Honest summary:** today, a single GitHub account is the practical single
point of failure for *continuing official development* (not for the
*data*, which is already multiply held by clone). Every other asset in the
table does not yet exist, which means the bus-factor question for them is
not yet "is it concentrated" but "has it been created with separation
built in from the start" — the recommendations throughout this document
series (§7.3's two-copy key model, §14.3's hardware-key registrar 2FA,
Model B's account-holder spreading) are written specifically to avoid
creating new single points of failure at the moment each asset is first
established, rather than trying to de-concentrate them afterward.
