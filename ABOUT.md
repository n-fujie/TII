# About TII

**TII — Transition-Ignition Identifier** (遷移発火識別子) is a reference and
audit infrastructure.

## What it is for

Scholarly and technical work often needs to record not just *that* something
exists, but **how a distinction, relation, function, or classification became
operative under specified conditions**, and how the recorded conditions,
addresses, interpretations, and relations changed afterward.

TII gives such a process a stable, opaque identifier and an append-only,
auditable history. Issuing a TII means only that **tracking has started from a
stated reference point** — nothing more.

## What it is not

TII is not a DOI clone, a URL shortener, an object-numbering service, or an
internal tool. It does not assume that identity is intrinsic, that ownership is
a fixed attribute, or that state, transition, and ignition are universal
primitives. These are revisable operational descriptions. See the
[Specification](/spec) for the full account.

## Stewardship and governance

The TII specification and reference registry are currently maintained by
**P/A Institute**, acting as the **current steward**.

Stewardship is a transferable operational role. It is **not** a component of TII
identifier identity, and it may be transferred under the TII Succession Policy. A
change of steward, technical operator, hosting provider, registrar, or resolver
domain does **not** change any issued `tii:` identifier. TII identifiers embed no
organization, person, date, country, or institutional ownership.

The change controller for the `tii:` URI scheme is the current steward — again, a
stewardship role, not ownership of TII.

If the steward ceases operation, the complete record — the append-only ledger,
the signed checkpoints, the key set, and the specifications — is published so
that any successor or the community can restore resolution without the original
operator, hosting provider, or domain.

## Independence from hosting and domain

The record of authority is a single append-only file (`data/ledger.jsonl`),
exportable as JSON / JSON Lines / CSV and rebuildable as a static file tree with
no server or database. The resolver base URL is a single configuration value
(`TII_RESOLVER_BASE_URL`); no hostname is embedded in the code, the ledger, or
any identifier. Changing the hosting provider, registrar, or resolver domain
does not change any identifier. A permanent resolver domain has not yet been
selected.

## Security

Integrity or vulnerability reports will be received at a role address
`security@` on the permanent domain (pending domain approval). Until then, use
the contact channel on the source repository.

## Source

The reference implementation and this specification are developed in the open.
See the **Source Repository** link in the footer.

## Status

- Specification: experimental (`0.1.x`); the production identifier profile is
  under a freeze audit and is not enabled.
- Public deployment: early; the public instance is a read-only static mirror on
  a replaceable third-party host.
- All currently issued identifiers are **test identifiers**. Production issuance
  is disabled.
