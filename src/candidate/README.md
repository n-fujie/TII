# src/candidate/ — NOT PRODUCTION

Supporting code for the **production-identifier freeze audit**. Read
[`spec/freeze-audit.md`](../../spec/freeze-audit.md) and
[`spec/identifier-syntax-1.0-candidate.md`](../../spec/identifier-syntax-1.0-candidate.md).

- `identifier.js` — candidate `tii:<token>` profile: 128-bit CSPRNG entropy,
  RFC 4648 Base32, unpadded, lowercase, 26 chars. Generator, strict parser,
  canonicalizer, resolver-URL builder.
- `checkpoint.js` — candidate signed-checkpoint design: SHA-256 ledger head
  bound into a checkpoint, signed with Ed25519 (`node:crypto`), verifiable from
  a plain file, with a key-rotation-aware keyset check.

**These files are not imported by `src/id.js`, `src/ledger.js`, `src/server.js`,
`src/export.js`, or `bin/tii.js`.** Issuing a TII still uses the provisional
12-character generator in `src/id.js`, and every issued identifier remains
`identifier_status: "test"`.

Production issuance stays **disabled**. Nothing in this directory changes that.
Deleting this directory fully reverts the audit's code footprint.
