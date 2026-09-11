# TII Human Decisions

> This sheet exists to reduce every remaining external launch blocker (G3,
> G7, G8, G9) to a fixed set of decisions a human can answer once. It does
> not reopen any technical decision already accepted (identifier syntax,
> single-authoritative-writer model, Ed25519 + RFC 8785 JCS checkpoints,
> public-only scope, or the principle that domain/steward/signing key are
> never TII identity) and does not re-run the external-infrastructure
> closure audit (`spec/external-infrastructure-closure.md`, commits
> `a964de6`/`38876da`). No domain was purchased, no key was generated, no
> IANA submission was sent, and no production TII was issued in the
> production of this sheet. **Production issuance remains DISABLED**
> regardless of how this sheet is answered — see §J's own text.

## TII HUMAN DECISIONS

```
A. Permanent domain
[ ] transition-ignition-id.org
[ ] tii-id.org
[ ] neither

B. Public steward
P/A Institute
Status: proposed / approve or correct

C. Legal/accountable name
____________________

D. Relationship to P/A Institute
____________________

E. IANA named contact
____________________

F. IANA Change Controller model
[ ] Individual
[ ] Organization

Exact Change Controller name:
____________________

G. Production key custody
[ ] Approve proposed two-copy model
[ ] Do not approve

H. Registrar
Recommended: Cloudflare Registrar

[ ] Approve
[ ] Reject

I. Authorize domain registration
[ ] YES
[ ] NO

J. Authorize production signing-key generation
[ ] YES
[ ] NO

K. Authorize future IANA provisional submission once prerequisites are satisfied
[ ] YES
[ ] NO
```

## Why each item matters

**A — Permanent domain.** This is the only remaining open question for
G7. `transition-ignition-id.org` is recommended: longer, but it spells out
the scheme's own name and carries essentially no abbreviation-confusion
risk. `tii-id.org` is shorter and more convenient to type, but leads with
the bare `tii` string that Technology Innovation Institute (Abu Dhabi,
`tii.ae`) also uses in the same general subject area (cryptographic
infrastructure) — a real, if not disqualifying, confusion risk that was
never independently cleared by a trademark search. Neither is registered;
whichever is chosen (or neither), nothing about the identifier itself
depends on this choice.

**B/C/D — Governance identity.** This is the entire reason G8 is
UNRESOLVED. "P/A Institute" is an operating name, not necessarily a legal
person — TII cannot have an IANA Change Controller or a domain registrant
of record until a human states what legal or individual identity stands
behind that name. This cannot be inferred from the repository, GitHub
account, or branding without guessing, which this project has consistently
refused to do.

**E — IANA named contact.** IANA's provisional-registration process
requires an actual accountable person, not a role mailbox. Until this is
supplied, the registration draft cannot be submitted regardless of every
other field being ready.

**F — Change Controller model.** An individual controller (D1) can be
named today, without waiting for an entity to exist, at the cost of being
a single named person until transferred. An organization controller (D2)
requires a legally established entity to actually exist first — if one
does not, D1 is the only currently available option, not a lesser choice.

**G/H — Key custody and registrar.** Both already have a recommended,
fully-researched default (the two-copy operational-plus-offline-backup key
model; Cloudflare Registrar for at-cost pricing, DNSSEC, and hardware-key
account protection). These items exist on the sheet only so the human
approves — or explicitly rejects — a default that was chosen for them, not
because either is still under open research.

**I/J/K — External-action authorizations.** These are the three
irreversible steps (buying a domain, generating a real signing key,
submitting to IANA) that nothing in this project may take without
explicit, separate sign-off. They are intentionally independent — approving
one is not approval for another — and **none of them, individually or
together, enables production TII issuance**, which requires a separate,
later authorization after a fresh full G1–G14 re-audit.

## Confirmation

No external action was taken in producing this sheet: no domain was
purchased, no DNS was changed, no role mailbox was created, no IANA
submission was sent, no production private key was generated, and no
production TII was issued. The external-infrastructure closure audit was
not re-run and no external re-checks (RDAP, IANA registry) were performed
— this sheet reuses the findings already recorded in
`spec/external-infrastructure-closure.md`. Production issuance remains
**DISABLED**.
