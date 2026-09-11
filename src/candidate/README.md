# src/candidate/ — NOT PRODUCTION

This directory is now **empty of source files** — everything that once lived
here has been promoted to `src/` as it was wired into a real (even if gated
or disabled) operational path. It is kept as a placeholder for future
candidate/not-yet-wired work, and to preserve the history/convention this
project follows: code lands here first, promotes to `src/` only when
something actually uses it.

## Promoted to live in production-hardening Phase 1

`jcs.js` (RFC 8785 JSON Canonicalization Scheme) and `checkpoint.js` (Ed25519
signed checkpoints) **used to live here** and are now **`src/jcs.js`** /
**`src/checkpoint.js`** — live, wired into `src/checkpoint-store.js`,
`bin/tii.js checkpoint *`, and the Audit page's "Signed checkpoint" section.
See [`spec/checkpoint-operation.md`](../../spec/checkpoint-operation.md).

## Promoted (gated) in the Production Launch Gate phase

`identifier.js` — the `tii:<token>` production profile: 128-bit CSPRNG
entropy, RFC 4648 Base32, unpadded, lowercase, 26 chars — **used to live
here** and is now **`src/identifier.js`**, wired into
`src/production-issuance.js` and `bin/tii.js issue --production`. It moved
because G1/G2 of `spec/production-launch-gate.md` require connecting the
production identifier code to a real (gated) issuance path, not because
production issuance is enabled — it is not. See
`spec/production-launch-gate.md` and `src/production-gate.js` for the
multi-condition gate that keeps it inert. `src/id.js`'s provisional
12-character generator remains the only thing TEST issuance
(`src/ledger.js` `issueTII()`) ever calls; every issued identifier in this
repository's committed configuration remains `identifier_status: "test"`.
