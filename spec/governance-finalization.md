# TII Governance — Finalization (G8)

> **G8 = UNRESOLVED.** This document separates every governance role
> explicitly, states exactly what information is still required from the
> human operator, and presents two technically valid governance models
> without choosing between them or inventing a legal identity. It does
> **not** supersede `spec/governance-candidate.md` — that document remains
> the fuller candidate model (public About copy, stewardship-transfer
> procedure, theoretical regression audit); this document is the
> closure-focused companion required by the External Infrastructure
> Closure phase, and the two must be read together.

## 1. Seven roles, kept explicitly separate

Per this phase's explicit instruction — do not collapse these into
"owner":

| # | Role | Current holder | Status |
|---|---|---|---|
| A | Public project/steward name | **P/A Institute** | Established as public-facing name |
| B | Legally accountable person or entity | — | **UNRESOLVED — see §3** |
| C | IANA Contact (named accountable person) | — | **UNRESOLVED — cannot be inferred, see §2** |
| D | IANA Change Controller | P/A Institute, acting as current steward — **candidate** | Pending B |
| E | Signing-key custodian | — | Not yet applicable — no production key exists (`spec/production-key-custody.md`) |
| F | Hosting operator | Vercel (current, replaceable) | Established, non-canonical |
| G | Registrar account controller | — | Not applicable — no domain registered (`spec/resolver-domain-decision.md`) |

**None of these is, or may become, part of TII identifier identity.** The
identifier is `tii:<token>`; it does not change if any role above changes
hands.

## 2. What this task will not do

Per explicit instruction: **do not infer legal identity or a named contact
from the repository name, GitHub identity, domain registration data, or
branding.** No such inference was performed. Role C (IANA Contact) and the
legal-entity half of role B remain unresolved because the information does
not exist in anything this task can observe — it requires a decision by an
actual accountable human, not a description that can be extracted from
project artifacts.

## 3. Legal-identity decision — two technically valid models

Presented as an operational-consequences comparison only. **No legal claim
is made by presenting either model.**

### MODEL A — Individual Change Controller

A named, accountable individual acts as the IANA Change Controller and
(where relevant) the legal signatory for domain/registrar/key-custody
matters.

**Operational consequences:**
- Fastest to establish — requires only one person's identity, once they
  agree to be named.
- **Single point of failure** unless a documented succession plan exists
  for that individual specifically (see the bus-factor audit,
  `spec/succession-manifest.md` §Bus-Factor).
- IANA correspondence and registrar/domain accounts can be registered
  directly to that person, or to a role email once one exists
  (`spec/governance-finalization.md` §5) that routes to them.
- Transfer to a future organization is possible later (see §4) but adds a
  second transition instead of starting there.

### MODEL B — Organization Change Controller

A legally established entity acts as the Change Controller, with
**P/A Institute** retained as the public-facing operating/research name
where that is legally accurate (i.e., P/A Institute is the entity's trade
name, DBA, or a project name under the entity, not itself a separate legal
person).

**Operational consequences:**
- Requires the entity to actually exist in a legally cognizable form
  before this model is accurate — if it does not yet exist, Model A is the
  only currently available option.
- Domain, registrar, and role-email accounts are registered to the entity,
  not an individual — reduces single-person dependency for those specific
  assets, but the entity still needs specific accountable individuals with
  account access (does not eliminate the bus-factor question, only
  reshapes it — see `spec/succession-manifest.md` §Bus-Factor).
- IANA's Change Controller field would name the entity; correspondence
  would still need to resolve to a specific accountable person at that
  entity in practice.
- If the entity later ceases operation: `spec/succession-policy.md` §2's
  "operator dissolution" scenario applies — stewardship transfers to a
  successor, or the project continues in read-only archival mode from the
  published succession kit. This does not orphan any issued identifier.

**This task makes no determination between Model A and Model B.** That
determination requires the human operator to state which is legally
accurate today — not something inferable from repository content.

## 4. Change Controller — required specification principle (unchanged, reconfirmed)

> "The change controller is a current stewardship role and is not part of
> TII identifier identity. Stewardship may be transferred under the TII
> Succession Policy."

This wording is preserved verbatim from `spec/governance-candidate.md` §2
and MUST appear in the eventual IANA registration and the public
specification, regardless of whether Model A or Model B is chosen.

- **If Model A is used initially:** transfer to an organization later is a
  recorded `stewardship.transferred` event plus an IANA change-controller
  update filed by the (still-current, until the transfer completes)
  individual — `spec/succession-policy.md` §3.
- **If Model B is used and that organization ceases operation:** the
  succession kit (`spec/succession-manifest.md`) lets any successor —
  individual or organization — continue from the last signed checkpoint;
  IANA is updated the same way, filed by whichever accountable party is
  recognized at the time.

## 5. Public steward — wording (unchanged, reconfirmed)

> **Current specification steward: P/A Institute.**
>
> "The current specification steward is an operational and governance
> role. It is not part of TII identifier identity and may be transferred
> under the TII Succession Policy."

This describes present stewardship only. It does not establish permanent
ownership, and is not itself a legal-identity statement (see §3 above for
the separate question of B).

## 6. G8 human-input form

Every field below is either REQUIRED BEFORE IANA, REQUIRED BEFORE
PRODUCTION, or OPTIONAL / PUBLIC DISPLAY ONLY. **No value is invented or
inferred by this task.** This form is the artifact a human operator fills
in; every row currently reads "—" here.

| Field | Value | Requirement |
|---|---|---|
| Public steward name | P/A Institute *(already established — §5)* | OPTIONAL / PUBLIC DISPLAY ONLY |
| Legal person/entity name | — | REQUIRED BEFORE IANA |
| Legal relationship to "P/A Institute" | — | REQUIRED BEFORE IANA |
| IANA named contact | — | REQUIRED BEFORE IANA |
| Preferred public role email | — | REQUIRED BEFORE PRODUCTION *(needs the approved domain first — `spec/resolver-domain-decision.md` §14)* |
| IANA Change Controller | — (Model A individual name, or Model B entity name) | REQUIRED BEFORE IANA |
| Signing-key custodian | — | REQUIRED BEFORE PRODUCTION |
| Domain registrant/controller | — | REQUIRED BEFORE PRODUCTION *(needed before domain registration, per `spec/resolver-domain-decision.md` §14.4)* |

## 7. Role emails — planned, not created

Per explicit instruction, role addresses are **not created in this task**.
Once a domain is approved and registered (`spec/resolver-domain-decision.md`
§14.4) and this form's remaining fields are resolved:

| Address | Purpose |
|---|---|
| `standards@<domain>` | Specification / IANA / governance correspondence |
| `security@<domain>` | Vulnerability and integrity reports |
| `registry@<domain>` | Operational identifier/resolution questions |

Role addresses **do not substitute** for the named accountable IANA
Contact (§6 row 4) where IANA requires an actual person — they are a
long-term-stable forwarding mechanism, not an identity.

## 8. Public governance language (concise, operational)

For the public `/about` page, answering exactly these questions and
nothing more — avoiding manifesto language on the operational governance
page (per this phase's explicit instruction; the fuller philosophical
framing, where wanted, belongs in `SPEC.md`/`ABOUT.md`'s existing text, not
duplicated here):

> **What is TII?** A reference and audit infrastructure that assigns a
> stable, opaque identifier to a reference point and records how its
> descriptions, relations, and classifications change, as an append-only,
> auditable history.
>
> **Who currently maintains the specification?** P/A Institute, as the
> current specification steward — a transferable role, not permanent
> ownership.
>
> **Who currently operates the registry?** The current steward, on
> replaceable third-party hosting (currently Vercel). The hosting provider
> is not part of TII identity.
>
> **How may stewardship transfer?** Under the TII Succession Policy — an
> appended, auditable event; see `spec/succession-policy.md`.
>
> **What does TII not guarantee?** See `spec/production-release-claims.md`
> for the complete list — notably, TII does not claim to be immutable,
> tamper-proof, unforgeable, independently timestamped, or privacy-
> preserving.
>
> **Where are security reports sent?** `security@<domain>` once the
> permanent domain and role email exist (§7); until then, via the project's
> existing repository issue tracker.

## 9. What remains blocking G8

**G8 = UNRESOLVED (as of this document's original drafting).** Blocked on:
§3's legal-identity model choice (A or B) and the specific legal name that
follows from it; §6's IANA named contact. Neither could responsibly be
supplied by this task at the time. See §10 below for the resolution.

## 10. Resolution (2026-09-11) — G8 = PASS

Every field §6's human-input form marked "REQUIRED BEFORE IANA" was
subsequently supplied by explicit human confirmation (not inferred), via
the decision-capture process recorded in full in `spec/human-decisions.md`:

| Field | Resolved value |
|---|---|
| Legal-identity model (§3) | **Model A — individual Change Controller** |
| Legal/accountable name (§6, row 2) | **Naoto Fujie** |
| Relationship to "P/A Institute" (§6, row 3) | **"Naoto Fujie is an individual operating publicly as P/A Institute."** — explicitly confirmed wording, not the agent's suggestion accepted by default |
| IANA named contact (§6, row 4) | **Naoto Fujie** |
| IANA Change Controller (§6, row 6) | **Naoto Fujie** (Model A) |

Role email (§6, row 5) remains open — it depends on the approved-but-not-
yet-registered domain (`transition-ignition-id.org`) and is correctly
sequenced after domain registration, per §7's "once and only once a
permanent domain is approved" rule; it was never a G8 blocker.

**G8 status: PASS.** §4's normative principle remains exactly as written
and now has a concrete referent: Naoto Fujie is the current Change
Controller, a stewardship role, not TII identifier identity, transferable
later under the TII Succession Policy without changing any issued `tii:`
identifier. See `spec/production-launch-gate.md`'s Final Closure Table and
`spec/launch-status.json` for the updated cross-gate picture — G8 resolving
does not itself change G3/G7/G9 or bring production issuance any closer to
enabled.
