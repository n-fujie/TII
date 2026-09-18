# First Production TII Issuance — Verification Record

> **Evidence and documentation only. This record grants no authorization
> for any future production issuance.** Machine-readable companion:
> [`first-production-issuance-2026-09-17.json`](first-production-issuance-2026-09-17.json).
> Every fact below is independently re-derivable from the repository's
> own read-only tooling — none of it is asserted on trust.

## Event

- **Production identifier:** `tii:fabdi3ifjwteyi3os2hwmx2l5i`
- **Issuance date:** 2026-09-17
- **Ledger event:** `evt_bfrbdmdd6sprept3`, `seq: 10`,
  `prev_hash: eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`,
  `hash: 398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc`

## Commits

| Commit | Role |
|---|---|
| `419de8f6988415e7bb55faf69fa161d57ea9fbac` | First production issuance (single-line append to `data/ledger.jsonl`) |
| `2306df1c0741e0d7046bbc45957d21dad50a082d` | Canonical completion record — the reviewed executable state this event is anchored to |
| `035b55de1cb3efc53fbb97453defdb755a34c823` | SOP documentation |

## Annotated tag

- **Name:** `tii-first-production-issuance-2026-09-17`
- **Resolved commit:** `2306df1c0741e0d7046bbc45957d21dad50a082d`
  (`git rev-parse tii-first-production-issuance-2026-09-17^{commit}`)
- **Signed:** No — annotated, not cryptographically signed
  (`git tag -v` reports "no signature found"). Not moved, replaced, or
  altered by this record. See `spec/production-issuance-sop.md` for the
  documented, deferred signing option.

## Ledger verification (`data/ledger.jsonl`)

| Fact | Value |
|---|---|
| Event count | 11 |
| SHA-256 | `34e415cbf63a721ee6aa5ea34907cbf095f67e526ddc401923d09037737fd664` |
| Head hash | `398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc` |
| Chain verify | `VALID` (`node bin/tii.js verify`) |
| Total `tii.issued` events | 2 (1 test, 1 production) |

## Checkpoint verification (public key only, no secret involved)

| File | Event count | Status | Matches current head |
|---|---|---|---|
| `checkpoint-0000000010-2026-09-17T031239532Z-d1515f.json` | 10 | VERIFIED | No (predates issuance — expected, not a forgery signal) |
| `checkpoint-0000000011-2026-09-17T041740279Z-51b8e4.json` | 11 | VERIFIED | Yes |
| `checkpoint-0000000011-2026-09-17T041740340Z-fbf603.json` | 11 | VERIFIED | Yes |

All three signed by key `1486de6152baec7f`
(`node bin/tii.js checkpoint verify --file <name>`).

## Test suite

**242/242 passing** (`npm test`), at the time this record was created.

## Explicit statements

- Tagging and SOP documentation work caused **no ledger mutation**.
- **No second production identifier** has been issued.
- This record is **evidence and documentation only** — it does not
  authorize, imply authorization for, or substitute review for any
  future production issuance.

## Provenance assessment (2026-09-18)

The annotated tag (`tii-first-production-issuance-2026-09-17`) is
**confirmed not cryptographically signed** — `git tag -v` reports "no
signature found." It has not been moved, replaced, or recreated to add
one.

**No additive cryptographic attestation was created.** This repository's
only established cryptographic provenance mechanism is Ed25519 checkpoint
signing (`src/checkpoint.js`, `spec/checkpoint-operation.md`), and every
existing checkpoint for this event is already independently verified
above. Creating a *new* signed attestation over the tag/commit pair would
require either (a) a new production checkpoint, which needs the
production passphrase and is explicitly out of scope for hardening work
(a checkpoint must never be created "merely for" a documentation task),
or (b) GPG-signing the tag, which needs a GPG key not established as part
of this project's provenance model and was not requested. Neither
requirement can be met without a secret unavailable to this process, so
per the governing instruction for this work, no additive attestation was
attempted — inventing one would overstate the cryptographic evidence
that actually exists.

**Deferred, documented future hardening options** (manual, human-run,
require the production passphrase or a personal GPG key — never
performed by an agent):
- `git tag -s <new-tag-name> 2306df1c0741e0d7046bbc45957d21dad50a082d` —
  a **new**, separate, GPG-signed tag pointing at the same immutable
  commit, without touching the existing annotated tag.
- A future signed checkpoint, created through the normal, fully-reviewed
  checkpoint ceremony (not as an incidental side effect of a
  documentation task), would still only attest to a ledger head — it
  would not itself sign the tag or the specific commit object.

## How to re-verify this record yourself

```bash
git rev-parse tii-first-production-issuance-2026-09-17^{commit}   # must equal 2306df1c0741e0d7046bbc45957d21dad50a082d
node bin/tii.js verify                                            # ledger chain integrity
node bin/tii.js checkpoint list                                   # checkpoint inventory
node bin/tii.js checkpoint verify --file <name>                   # each checkpoint's signature, public key only
npm test                                                          # full suite
```

No step above requires the production passphrase or any secret.
