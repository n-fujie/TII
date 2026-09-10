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

## Maintainer

Developed and maintained by **P/A Institute**.

P/A Institute is the current developer and maintainer, not a permanent owner of
the identifier system. TII identifiers embed no organization, person, date,
country, or institutional ownership, and the system is designed to remain
operable if maintenance passes to another party. Any such change is itself
recorded as an event.

## Independence from hosting

The record of authority is a single append-only file (`data/ledger.jsonl`). The
entire set of records can be exported as JSON, JSON Lines, or CSV and rebuilt as
a static file tree with no server or database. The resolver base URL is a
configuration value; changing the hosting provider or domain does not change any
identifier.

## Source

The reference implementation and this specification are developed in the open.
See the **Source Repository** link in the footer.

## Status

- Specification: experimental (`0.1.x`).
- Public deployment: early; the public instance is a read-only static mirror.
- All currently issued identifiers are **test identifiers**.
