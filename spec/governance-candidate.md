# TII Governance — Candidate

> **CANDIDATE. Nothing here is finalized.** No permanent governance identity has
> been established. The roles below are current, transferable operational
> relations — not components of TII identifier identity. Production issuance
> remains **DISABLED**.

## 0. The distinction this document exists to keep

TII governance separates five things that are usually conflated:

| Layer | Current holder (candidate) | In the token? | Transferable? |
|---|---|---|---|
| **Identifier identity** — `tii:<token>` | — (the token is 128 random bits) | never | the string is immutable once issued |
| **Specification stewardship** — who edits the spec and runs the registry | P/A Institute (candidate) | never | yes — under the Succession Policy |
| **Legal organization** — the entity that may hold the domain, keys, accounts | undecided | never | yes |
| **Technical operator** — who deploys and runs the resolver | undecided (currently the steward) | never | yes |
| **Hosting provider** — where the service executes | Vercel (now) | never | freely, anytime |

Only the first is a permanent compatibility obligation. The rest are recorded as
governance / infrastructure information and as append-only ledger events
(`stewardship.transferred`, `authority.transferred`), never as identifier
properties and never as new mandatory TII core fields (repository `SPEC.md`
does not change).

## 1. Current specification steward (candidate)

**P/A Institute**, acting as the **current steward of the TII specification and
registry**.

Steward responsibilities (candidate):

- maintain the public specification and the identifier-syntax specification;
- operate the reference registry and resolver, or delegate their operation;
- publish signed checkpoints (`identifier-syntax-1.0-candidate.md` §15–17);
- hold the resolver domain, signing keyset, and IANA change-controller role;
- record stewardship changes as append-only events and hand over the succession
  kit (`succession-policy.md` §1) on transfer.

**P/A Institute is not an immutable or ontologically privileged owner of TII.**
It is the present steward. If P/A Institute dissolves, transfers the role, or is
replaced by a governance body, TII identifiers are unaffected and the successor
continues from the succession kit.

Normative wording (candidate — for the spec and the public About page):

> *"P/A Institute is the current steward of the TII specification and registry.
> Stewardship is a transferable operational role, not a component of TII
> identifier identity, and may be transferred under the TII Succession Policy.
> A change of steward does not change any issued `tii:` identifier."*

## 2. IANA change controller (candidate — pending approval)

For the IANA provisional URI-scheme registration
(`iana-provisional-registration.md`):

> **Change controller:** *P/A Institute, acting as the current steward of the
> TII specification.* **(CANDIDATE — pending explicit approval.)**

Normative wording (candidate — to appear in the public specification):

> *"The change controller is a current stewardship role and is not part of TII
> identifier identity. Stewardship may be transferred under the TII Succession
> Policy."*

The change controller is **never** encoded into any identifier. A change of
change-controller is an IANA registry update plus a recorded stewardship event;
it changes no `tii:` string.

## 3. IANA contact (candidate — pending domain approval)

IANA requires a responsible contact.

- **Named responsible person:** *PROVISIONAL — requires explicit approval.* A
  named, accountable person is required by IANA where applicable; the name is
  not published here and is not finalized.
- **Preferred long-term public contact:** a domain role address
  `standards@<approved-domain>` (see §4). **Not created.**
- **Interim, until the domain and mail provider are approved:** the project's
  existing contact channel may be used for correspondence, but the long-term
  public standards contact SHOULD be a domain role address so the person behind
  it can change without a registry update. A personal Gmail address MUST NOT be
  the preferred long-term public standards contact once a domain role address
  can be established.

## 4. Role email addresses (candidate — none created)

Designed so responsibility transfers without changing public infrastructure. To
be created **only after** the permanent domain and a mail provider are
explicitly approved.

| Address | Purpose |
|---|---|
| `standards@<domain>` | specification / IANA / standards correspondence |
| `security@<domain>` | vulnerability and integrity reports (see the spec's Security Considerations) |
| `registry@<domain>` | identifier / resolver operational questions |

- Keep the set **small** — these three, no more, unless a concrete need arises.
- Each address is a **role**, routed to whoever currently holds it; no specific
  human is permanently inseparable from a role address.
- Mail DNS (`MX` / `SPF` / `DKIM` / `DMARC`) is added only when these are
  approved (`resolver-domain-decision.md` §9).
- **No email account was created by this task.**

## 5. Stewardship transfer (summary; full policy in `succession-policy.md`)

A stewardship transfer is an **appended** event recording: previous steward, new
steward, effective time, evidence, authorization or signature, and any
contestation. On transfer, the outgoing steward:

1. hands over the succession kit (ledger export, signed checkpoints, keyset,
   specs, domain + registrar + DNS control, IANA change-controller update);
2. co-signs a final checkpoint with the incoming steward where possible;
3. the incoming steward rotates in a new signing key via the keyset
   (`identifier-syntax-1.0-candidate.md` §16) and files the IANA
   change-controller update.

A change of steward mints **no** new TII and changes **no** issued identifier.

## 6. Official designated resolver vs. independent mirrors

- The **designated resolver** is the resolver operated by (or delegated by) the
  current steward at the approved domain. It is authoritative for *convenience*,
  not for *identity*.
- **Independent mirrors** may resolve TIIs from a published ledger export +
  signed checkpoints. A mirror does **not** become authoritative merely because
  it resolves a TII, and users SHOULD be able to tell which resolver they are
  on.
- Conversely, the designated resolver is **not** the metaphysical identity of a
  TII. If it disappears, the identifiers persist and another resolver (steward's
  or a successor's or a community mirror's) can be stood up from the export.
- This is the same principle as `identifier-syntax-1.0-candidate.md` §18
  (external witnesses are optional, never foundational).

## 7. Public About / Governance section (candidate copy)

For the public `/about` page. Institutional and precise; not a manifesto.

> **About TII**
>
> TII — Transition-Ignition Identifier — is a reference and audit infrastructure.
> A `tii:` identifier names a reference point whose descriptions, relations,
> addresses, interpretations, and classifications are recorded as an
> append-only, auditable history.
>
> **Current steward.** The TII specification and reference registry are
> currently maintained by P/A Institute. Stewardship is a transferable
> operational role. It is not a component of TII identifier identity, and it
> may be transferred under the TII Succession Policy. A change of steward,
> operator, hosting provider, registrar, or resolver domain does not change any
> issued `tii:` identifier.
>
> **Specification changes.** The change controller for the `tii:` URI scheme is
> the current steward. This is a stewardship role, not ownership of TII.
>
> **Succession.** If the steward ceases operation, the complete record — the
> ledger, signed checkpoints, the key set, and the specifications — is
> published so any successor or the community can restore resolution without
> the original operator, hosting provider, or domain.
>
> **Security.** Integrity or vulnerability reports: `security@<domain>` (a role
> address; pending domain approval).
>
> **Hosting.** The service currently runs on a third-party hosting provider.
> The provider is not part of TII identity and is replaceable at any time.

## 8. Theoretical regression audit — governance

Verified: the governance model does **not** reintroduce —

| Concern | Reintroduced? | Why not |
|---|---|---|
| Immutable ownership | No | No owner in the token or core; steward/operator/organization are recorded relations. |
| Permanent institutional sovereignty | No | Every role is transferable under the Succession Policy; the spec says so explicitly. |
| Fixed address / fixed domain as identity | No | The domain is configuration (`TII_RESOLVER_BASE_URL`), never in the token; §6 separates resolver from identity. |
| Permanent P/A Institute authority | No | "Current steward", transferable; dissolution handled by succession; nothing durable encodes P/A Institute. |
| Permanent human controller | No | IANA contact and role addresses are roles, not persons; the person behind a role can change without a registry update. |
| Hosting-provider dependence | No | Vercel is non-canonical and replaceable; the code hard-codes no host (`resolver-domain-decision.md` §7). |
| Resolver dependence as identifier identity | No | Identifiers persist and re-resolve from an export if every resolver disappears (`domain-failure-and-recovery.md`). |

## 9. Final governance decision table

| Item | Value | Status |
|---|---|---|
| Official name | Transition-Ignition Identifier | fixed |
| Abbreviation | TII (non-exclusive; see `resolver-domain-decision.md` §5) | fixed |
| Current specification steward | P/A Institute | **candidate** |
| IANA Contact (named person) | — | **candidate / unresolved** |
| IANA Contact (role address) | `standards@<approved-domain>` | **candidate / domain-dependent, not created** |
| IANA Change Controller | P/A Institute, acting as current steward | **candidate / unresolved** |
| Role email addresses | `standards@` `security@` `registry@` | **candidate / domain-dependent, not created** |
| Permanent resolver domain | `tii-id.org` (primary, conditional) / `transition-ignition-id.org` (fallback) | **candidate / unresolved, not registered** |
| Hosting provider | Vercel | **non-canonical / replaceable** |
| Registrar | — | **unresolved** |
| IANA registration | RFC 7595 provisional draft prepared | **NOT SUBMITTED** |
| Production issuance | — | **DISABLED** |

## 10. Production Launch Gate re-check (2026-09-11) — appended, nothing above erased

Re-evaluated explicitly as launch gate **G8** in
`spec/production-launch-gate.md`. Per that task's own instruction — "If
legal status is unresolved: G8 = UNRESOLVED. Do not guess." — this phase
makes **no** determination of P/A Institute's legal entity status (whether
it is itself a legal entity name or an operating name for some other legal
entity) and supplies **no** named individual for the IANA contact field.
Both remain exactly as documented above: **candidate / unresolved**.
**G8 = UNRESOLVED.** This is not a regression from this table — the table
above already carried these fields as unresolved; this section confirms
that status explicitly, in the vocabulary the launch-gate audit uses, and
states plainly that resolving it requires steward input this task does not
have and is not authorized to invent.
