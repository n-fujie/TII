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
