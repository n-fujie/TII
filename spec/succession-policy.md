# TII Succession Policy — Candidate

> Candidate for the freeze audit. Not final. Makes **no** claim of metaphysical
> or absolute permanence.

## 0. The three things this policy keeps separate

1. **Identifier persistence** — a `tii:<token>` string, once issued for a
   production reference, keeps referring to that reference point and is never
   reused, reassigned, or deleted.
2. **Availability of a particular resolver** — whether
   `https://<some-domain>/tii/<token>` currently answers. This can lapse and be
   restored elsewhere without touching (1).
3. **Continued institutional operation** — whether a particular organization
   (initially P/A Institute) still runs TII. This can end without touching (1),
   and (2) can be re-established by others.

A succession event affects (2) and/or (3). It never rewrites (1).

## 1. What must always be exportable

The **canonical succession kit**, all plain UTF-8 files, no proprietary
dependency:

- the append-only ledger (`ledger.jsonl`);
- all signed checkpoint files;
- the keyset file (public keys + validity windows);
- the frozen identifier + data specifications;
- this policy.

Any party holding a recent copy of the kit can verify the SHA-256 chain, verify
the Ed25519 checkpoints, rebuild all derived state and the resolver, and
continue in read-only or read-write mode.

## 2. Scenarios

| Scenario | Response | Identifier impact |
|---|---|---|
| **Operator dissolution** | Stewardship transfers (appended event) to a successor, or the community continues from the succession kit in read-only mode. Publish a final signed checkpoint. | none |
| **Loss of domain** | Stand up the resolver on a new domain; repoint `TII_RESOLVER_BASE_URL`; announce via the mirrors and the source repository. | none — the domain was never in the token |
| **Loss of hosting** | Redeploy the (dependency-free) resolver anywhere, or serve the static export from any static host / IPFS / a local machine. | none |
| **Loss of database** | There is no primary database; the ledger file is the record of authority. Rebuild from `ledger.jsonl`. | none |
| **Loss of signing key** (lost, not compromised) | Publish a keyset entry closing the old key's window; rotate in a new key; new checkpoints use it. Old checkpoints stay verifiable against the old key. | none |
| **Signing key compromised** | Publish `revoked_at`; checkpoints dated after it are rejected; rotate; if forged post-revocation checkpoints circulated, the multi-location honest copies and the pre-revocation checkpoint chain establish the true head. | none |
| **Loss of all current maintainers** | Community reconstruction from the succession kit. The spec + tests + zero dependencies make this tractable. Read-only archival continuation is an acceptable steady state. | none |
| **Transfer to another organization** | Appended stewardship-transfer event: previous steward, new steward, effective time, evidence, authorization/signature, contestation if any. New steward may rotate signing keys via the keyset. | none |
| **Community fork / competing continuations** | Each continuation is a copy of the ledger from a common checkpoint; divergence after that point is visible by comparing checkpoints. This is a governance dispute, not an identifier failure; identifiers issued before the fork mean the same thing in both. | none for pre-fork identifiers |

## 3. Stewardship transfer procedure

1. Outgoing and incoming steward each publish intent.
2. Append a `stewardship.transferred` event (open vocabulary) with:
   `previous_steward`, `new_steward`, `effective_at`, `evidence` (`basis`),
   `authorization` (signature or reference), and space for `contestation`.
3. The incoming steward publishes a signed checkpoint under a key in the keyset
   (rotating in a new key first if desired).
4. The resolver shows the current steward as a derived relation and the full
   transfer history.
5. A contested transfer is recorded, not silently resolved; both the asserted
   transfer and the contestation resolve.

The steward is never encoded in the token. A transfer never mints a new TII.

## 4. Read-only archival continuation

A valid steady state: no new issuance, resolver served from the static export,
periodic re-publication of the last signed checkpoint to archival services. All
previously issued identifiers keep resolving and keep explaining their status.

## 5. What this policy does not promise

- That a resolver will always be online at a particular address.
- That any institution will operate forever.
- That the referenced material will persist.
- Metaphysical or absolute permanence of anything.

It promises only that the **identifier string and its recorded history remain
recoverable and verifiable** from an exported succession kit, through every
scenario in §2, without changing any already-issued identifier.
