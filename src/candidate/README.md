# src/candidate/ — NOT PRODUCTION

Supporting code for the **production-identifier freeze audit**. Read
[`spec/freeze-audit.md`](../../spec/freeze-audit.md) and
[`spec/identifier-syntax-1.0-candidate.md`](../../spec/identifier-syntax-1.0-candidate.md).

- `identifier.js` — candidate `tii:<token>` profile: 128-bit CSPRNG entropy,
  RFC 4648 Base32, unpadded, lowercase, 26 chars. `generateToken` /
  `issueIdentifier`, `parseCanonicalTII` (strict) / `parseTIIReference`
  (RFC 3986: separates a `#fragment`), `canonicalize`, `resolutionUrl`.
- `jcs.js` — RFC 8785 JSON Canonicalization Scheme: `canonicalize(value)` and a
  strict `parse(text)` that rejects duplicate property names. Used only as the
  signed-checkpoint signing input. **Separate from `src/canonical.js`** (the
  historical ledger hash-chain canonicalization), which is unchanged.
- `checkpoint.js` — candidate signed-checkpoint design: SHA-256 ledger head
  bound into a checkpoint, canonicalized with RFC 8785 JCS, signed with Ed25519
  (`node:crypto`), verifiable from a plain file, with a key-rotation-aware
  keyset check (`not_before` / `not_after` / `revoked_at`).

**These files are not imported by `src/id.js`, `src/ledger.js`, `src/server.js`,
`src/export.js`, `src/projection.js`, `src/canonical.js`, or `bin/tii.js`.**
Issuing a TII still uses the provisional 12-character generator in `src/id.js`,
and every issued identifier remains `identifier_status: "test"`.

Production issuance stays **disabled**. Nothing in this directory changes that.
Deleting this directory fully reverts the audit's code footprint.
