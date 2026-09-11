# src/candidate/ — NOT PRODUCTION

Supporting code for the **production-identifier freeze audit**. Read
[`spec/freeze-audit.md`](../../spec/freeze-audit.md) and
[`spec/identifier-syntax-1.0-candidate.md`](../../spec/identifier-syntax-1.0-candidate.md).

- `identifier.js` — candidate `tii:<token>` profile: 128-bit CSPRNG entropy,
  RFC 4648 Base32, unpadded, lowercase, 26 chars. `generateToken` /
  `issueIdentifier`, `parseCanonicalTII` (strict) / `parseTIIReference`
  (RFC 3986: separates a `#fragment`), `canonicalize`, `resolutionUrl`.

**Not imported by `src/id.js`, `src/ledger.js`, `src/server.js`, `src/export.js`,
`src/projection.js`, `src/canonical.js`, or `bin/tii.js`.** Issuing a TII still
uses the provisional 12-character generator in `src/id.js`, and every issued
identifier remains `identifier_status: "test"`. Production issuance stays
**disabled** (see `spec/production-hardening-phase1.md` §36). Wiring this
generator in requires a separate, explicit launch decision after the permanent
domain, governance, and IANA registration are settled.

## Promoted to live in production-hardening Phase 1

`jcs.js` (RFC 8785 JSON Canonicalization Scheme) and `checkpoint.js` (Ed25519
signed checkpoints) **used to live here** and are now **`src/jcs.js`** /
**`src/checkpoint.js`** — live, wired into `src/checkpoint-store.js`,
`bin/tii.js checkpoint *`, and the Audit page's "Signed checkpoint" section.
See [`spec/checkpoint-operation.md`](../../spec/checkpoint-operation.md). They
moved because production hardening's whole point was to connect them to the
operational path; the identifier profile above was explicitly **not** part of
that phase and stays candidate-only.
