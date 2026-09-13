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
  the committed canonical ledger — production issuance is disabled, and
  although an active production signing key now exists (`1486de6152baec7f`,
  `spec/production-key-custody.md` §8.7), it has never been configured
  into any environment that reads the real ledger; checkpoint creation
  was only ever exercised in this project's automated tests, against
  disposable throwaway ledgers that are discarded when the
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

- **Status: ACTIVE.** Key ID **`1486de6152baec7f`** (Ed25519), generated
  2026-09-13 by the human operator directly into passphrase-encrypted
  PKCS8 form (no plaintext private-key file ever existed on disk), is the
  production checkpoint-signing authority. Public key SHA-256:
  `8712c17570beaacf079e4909e36b3762f1a1163e0e2575d84d3130b5a97e4311` —
  independently recomputed by the agent from the file itself, not merely
  taken from the human's report. Full ceremony record, including
  independent verification of the operational file, the separately-held
  USB recovery copy, and a recovery rehearsal: `spec/production-key-custody.md`
  §8.7. **This is a statement about checkpoint-signing capability only —
  it does not by itself enable production TII issuance**, which remains a
  separate, independently-gated condition (`src/production-gate.js`) and
  is currently DISABLED.
- **Two earlier ceremony keys are permanently retired, never activated:**
  - `1b96b82d535afc95` (generated 2026-09-12) — its custody design (plain
    PEM protected by filesystem permissions + host disk encryption) did
    not satisfy the approved "encrypted private signing key" model.
  - `46b11023f849e931` (generated 2026-09-13) — generated correctly under
    the corrected passphrase-encrypted-PKCS8 mechanism, but its
    human-chosen passphrase was only 9 bytes, judged insufficient for a
    long-lived production root key.
  - Neither was ever used for a real checkpoint. Both had their
    private-key material securely removed (best-effort overwrite —
    not a cryptographic erasure guarantee on SSD/flash media); one
    non-secret public key is retained per retired key as audit evidence.
- **The active key's public key is self-embedded** in every checkpoint
  file it signs, and additionally recorded (public key only, never the
  private key) in `checkpoints/keyset.json` alongside its `key_id` and
  validity window, once the first real checkpoint is created against the
  committed ledger (see §3 above — none has been yet; only disposable
  test ledgers have exercised signing so far).

## 5. Resolver-domain operational dependencies

- **Permanent domain: REGISTERED (2026-09-12).**
  `transition-ignition-id.org`, registrar **Vercel Registrar** (not
  Cloudflare — decision H was explicitly superseded; reasoning and the
  resulting registrar/hosting coupling recorded in
  `spec/resolver-domain-decision.md` §15/§17), expires 2026-09-12→2027-09-12,
  auto-renew **ON**. Attached directly to the `tiiarchive` Vercel project.
  Registration independently verified via live RDAP, not taken on the
  registrant's report alone (`spec/resolver-domain-decision.md` §16).
  `tii-id.org` was never registered and is no longer a live candidate —
  the decision is closed.
- **Domain is now the canonical designated resolver.**
  `https://transition-ignition-id.org` serves the full public site (`/`,
  `/registry`, `/spec`, `/audit`, `/about`, `/catalog.json`, `/ja`,
  `/tii/<token>`), verified live.
- **`tiiarchive.vercel.app` remains a working, explicitly non-canonical
  mirror** — same project, same build, still reachable, and its own
  `catalog.json` self-reports `resolver_base` as the new domain rather
  than itself. **Not identity-bearing** — the identifier contains no
  hostname (`spec/identifier-syntax-1.0-candidate.md` §9); this endpoint
  remains replaceable at any time and does not need to be preserved for
  succession.
- **Configuration dependency:** exactly one environment variable,
  `TII_RESOLVER_BASE_URL`, controls the resolver base everywhere in the
  codebase (`spec/resolver-domain-decision.md` §7) — confirmed live and
  correctly set to `https://transition-ignition-id.org` on the actual
  deployment (observed via `catalog.json`, not merely assumed).
- **Registrar/hosting coupling now exists** (honest note, unchanged from
  `spec/resolver-domain-decision.md` §17): domain and hosting are under
  the same Vercel account (`platoststems-projects`). This does not affect
  TII identifier identity but does mean an eventual registrar-independent
  transfer would need an extra step it wouldn't have needed under
  Cloudflare.

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
| Who controls the domain? | **The Vercel account/team `platoststems-projects`** (registrar: Vercel Registrar, registered 2026-09-12 — `spec/resolver-domain-decision.md` §16). This is an infrastructure-account fact, not a legal-identity one; it does not by itself establish who has ultimate authority over that account — that traces to the same governance identity resolved in `spec/governance-finalization.md` §3/§6 (Naoto Fujie). |
| Who can transfer the domain? | Whoever controls the `platoststems-projects` Vercel account — same answer as above. Outbound EPP transfer is supported (Vercel quotes a transfer price, `spec/resolver-domain-decision.md` §15), so the domain is not locked to Vercel permanently. |
| Who controls IANA Change Controller updates? | **Nobody yet — nothing is registered with IANA.** Once registered, the accountable party is whoever `spec/governance-finalization.md` §3/§6 resolves to (Model A individual or Model B entity). |
| Who controls the public specification? | The current steward (P/A Institute, candidate — `spec/governance-candidate.md`), via the source repository (`https://github.com/n-fujie/TII`). |
| Who holds the signing key? | **The human operator holds the passphrase to the active production key, `1486de6152baec7f`** (Ed25519, generated 2026-09-13 directly into passphrase-encrypted PKCS8 form — `spec/production-key-custody.md` §8.7). Two earlier ceremony keys (`1b96b82d535afc95`, `46b11023f849e931`) were generated and retired before this one, never activated. Active for checkpoint signing only — does not by itself enable production TII issuance. |
| Who holds the offline key backup? | **The human operator**, on a physically separate USB device, independently confirmed byte-identical to the operational copy (SHA-256 `ad7d345fae18530da94a40b525b2e27510a85c1ea7f889358ef18832a9679a45`) by the agent reading the USB volume directly — `spec/production-key-custody.md` §8.7. Currently a single physical copy; if institutional (multi-person) succession is later required, a second geographically-separate recovery copy should be considered (see the bus-factor note below). |

The domain rows above were updated 2026-09-12 following independent
verification of the registration (`spec/resolver-domain-decision.md`
§16); the signing-key rows were updated 2026-09-13 following the final
key ceremony (`spec/production-key-custody.md` §8.7) — see
`spec/production-launch-gate.md`'s Final Closure Table for the full
gate-by-gate status.

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
| Signing private key (operational copy) | **Yes — single human operator, single machine.** Active key `1486de6152baec7f`, passphrase-encrypted PKCS8, held only by the human operator (`spec/production-key-custody.md` §8.7). Two prior ceremony keys were generated and retired (`1b96b82d535afc95` 2026-09-12, `46b11023f849e931` 2026-09-13) before this one. | A separate, independently-verified USB recovery copy exists (see row below), satisfying §7.3's minimum — but the passphrase itself is a single point of failure: if the one person who knows it is unavailable, the key is unrecoverable regardless of how many encrypted copies exist. Institutional succession would require a documented passphrase-escrow or multi-party scheme, not yet in place. |
| Signing private key (offline backup) | **Yes — single physical USB device, same operator.** Confirmed byte-identical to the operational copy (SHA-256 `ad7d345fae18530da94a40b525b2e27510a85c1ea7f889358ef18832a9679a45`), independently verified by the agent. | Satisfies "not the same file/directory as the operational copy," but is **not** yet "a different person/account/vendor" (`spec/production-key-custody.md` §7.3/§8.3) — both copies are controlled by the same individual. Acceptable for TII's current pre-production, single-operator scale per §12's own framing above; would need a second custodian before this stops being a true single point of failure. |
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
