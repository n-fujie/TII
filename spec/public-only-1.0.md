# TII 1.0 Is Public-Registry-Only (P1)

## Normative statement

> **TII 1.0 public registry implementations MUST NOT record secrets,
> credentials, private personal information, embargoed evidence, restricted
> security information, or other material requiring confidential disclosure
> within the public canonical ledger.**

## This is a scope limit, not a privacy claim

These are different statements, and this document makes only the first:

- ❌ **Not claimed:** "TII is privacy-safe." TII has no privacy mechanism.
- ✅ **Actually true:** "TII 1.0 public registry is designed for public
  records only. Restricted-disclosure handling is not implemented in this
  version."

Every field of every event, on a public TII 1.0 deployment, is visible on
every output surface: the resolution HTML page, the JSON API, the JSONL/JSON/
CSV exports, the static site build, and (per [checkpoint-operation.md](checkpoint-operation.md))
signed checkpoint metadata about the ledger's head. There is no disclosure
classification, no encryption, no redaction, no access control on reads.
This was demonstrated empirically in `spec/capability-boundary-audit.md` §40
before this phase, and nothing in Phase 1 changes that finding — Phase 1
**narrows the claim TII makes about itself** to match what is actually true,
rather than building a privacy subsystem this phase's scope excludes.

## What operators and recorders must not do

Because everything written to the ledger is public by design, TII 1.0 must
not be used to record:

- Secrets, passwords, API keys, private cryptographic key material.
- Credentials of any kind (the admin write-token itself is never recorded —
  see [production-hardening-phase1.md](production-hardening-phase1.md)
  §Admin fail-closed — and the same discipline applies to anything a
  recorder might enter as event content).
- Private personal information (the kind a data-protection regime would
  classify as personal data requiring a lawful basis and access controls).
- Embargoed evidence (material under a disclosure embargo — e.g. an
  unpublished vulnerability, an unreleased finding) before its embargo ends.
- Restricted security information.
- Any other material whose disclosure requires confidentiality controls TII
  does not implement.

## UI warning (implemented)

Every admin/write interface carries a visible warning before any mutation
form, added as part of this phase's `src/views.js` `adminPage()`:

> **PUBLIC RECORD.** Information recorded here may appear in public exports,
> APIs, static mirrors, and archival copies. Do not enter secrets,
> credentials, private personal data, or restricted evidence.

This banner renders above the Issue and Append forms whenever admin is
enabled (`TII_ADMIN_TOKEN` configured); when admin is disabled, no form is
rendered at all (see [production-hardening-phase1.md](production-hardening-phase1.md)).

## Basic operational safety implemented this phase

This phase adds only concrete, non-speculative safety measures — not an AI
content classifier, which is out of scope:

- **The admin write-token field is never a place secrets get recorded as
  TII metadata.** It authenticates the *write operation itself*; it is
  never persisted into any event, never echoed in any response, and never
  logged — see [production-hardening-phase1.md](production-hardening-phase1.md)
  §Admin fail-closed and `test/admin-security.test.js` test I.
- **No admin credential is ever logged.** Server startup logging
  (`src/server.js`) reports *whether* a token/key is configured
  (`"required (admin enabled)"` / `"NOT SET"`), never the value.
- **TII does not ask for secrets as identifier metadata anywhere in its
  schema.** SPEC.md's required fields (`recorder`) and optional modules
  (state/transition/ignition/address/domain/etc.) have no dedicated
  "credential" or "secret" field for a recorder to misuse in the first
  place — there is no field this phase needs to add rejection logic to, and
  the absence itself is the safety property. This was verified by re-reading
  `src/ledger.js`'s field list and `SPEC.md`'s module catalogue during this
  phase; no such field exists to guard.

No classifier that inspects arbitrary free-text `content` values for
"looks like a secret" was added — that would be exactly the kind of
speculative AI classification the task instructs against ("basic operational
safety, not speculative AI classification"). The safety measures above are
concrete and structural: the token never enters the record path at all,
rather than being scanned for and stripped after the fact.

## What restricted-disclosure handling would require — explicitly NOT implemented in TII 1.0

Documented as future possibilities only, per the task's instruction not to
add them to the live core this phase:

- **Encrypted evidence** — storing a ciphertext blob (or a hash + a
  separately-held encrypted payload) instead of plaintext content, with key
  material held outside the ledger entirely.
- **Selective disclosure** — cryptographic constructions (e.g. Merkle
  commitments over a record's fields) that let a verifier confirm a claim
  about a record without seeing the whole record.
- **Commitment records** — publishing a hash/commitment now, with the
  actual content disclosed later (useful for embargoed findings: prove *when*
  something was known without revealing *what* until the embargo lifts).
- **Redaction-as-event** — an explicit, append-only event type recording
  "this field was redacted, by whom, under what policy," distinct from
  simply not publishing a field — preserving the append-only audit property
  even for what's withheld.
- **Access-controlled payload storage** — separating "the ledger record
  (public)" from "an associated payload (access-controlled)," referenced by
  hash, analogous to how large evidence is already recommended to be
  referenced rather than stored inline (`spec/capability-boundary-audit.md`
  §30/§31).

None of these exist in `src/` as of this phase. Any future phase that adds
one of them must not silently start claiming "TII is privacy-safe" either —
each would need its own explicit statement of exactly what it protects
against and what it does not.
