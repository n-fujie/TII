# Signed Checkpoints — Operation (P0-A)

## The two claims — never collapse them

TII exposes two **independent** claims about the ledger. They use different
vocabularies, different code paths, different UI sections, and different
machine-readable status fields, on purpose. Neither implies the other.

| Claim | Question it answers | Status vocabulary | Code |
|---|---|---|---|
| **A — Ledger chain integrity** | "Is this copy of the ledger internally self-consistent — do the hashes chain correctly?" | `VALID` / `INVALID` | `Ledger.verify()`, `src/ledger.js` |
| **B — Signed checkpoint** | "Does an independently held, digitally signed attestation confirm this ledger's head is the one that was actually signed — has the ledger since been fully rewritten?" | `VERIFIED` / `UNVERIFIED` / `MISSING` / `INVALID` | `checkpointStore.verifyCheckpoint()`, `src/checkpoint-store.js` |

**Claim A cannot detect a full-chain forgery.** An attacker with write access
to `ledger.jsonl` can rewrite any historical event and recompute every
downstream `hash`/`prev_hash` from that point forward; the result is
internally consistent — `verify().ok === true` — even though every event
after the tamper point is different from what was originally recorded. This
is proven by a **permanent regression test**,
`test/checkpoint-store.test.js` test C, which the task requires to remain in
the suite indefinitely:

1. Build a ledger, create a legitimately signed checkpoint of its real head.
2. Forge a copy: rewrite event #2, recompute the entire downstream SHA-256
   chain with the real hash function.
3. `forgedLedger.verify().ok === true` — claim A says VALID. The forgery is
   invisible to chain-integrity checking alone.
4. `verifyCheckpoint(forgedLedger, {dir: originalCheckpointDir})` returns
   `status: 'VERIFIED'` (the checkpoint *file* is still validly signed — it
   was never touched) but `matches_current_head: false`, because the forged
   ledger's head hash differs from the hash the checkpoint attests to. The
   checkpoint still names the *real* original head. **This is claim B
   catching exactly what claim A cannot.**

This is why the CLI, the JSON API, and the Audit page always report these as
two separate fields/sections — `tii verify` only ever prints
`claim: 'ledger_chain_integrity'`; `tii checkpoint verify` only ever prints
the checkpoint claim; `GET /status` reports `ledger_chain_integrity` and
`signed_checkpoint` as two independent keys; the Audit page renders "Ledger
chain integrity" and "Signed checkpoint" as two separate `<h2>` sections with
a note explaining the distinction. No surface in this codebase ever merges
them into one boolean or one "verified" badge.

## What a checkpoint binds

A checkpoint attests exactly six facts, and nothing else (`src/jcs.js` +
`src/checkpoint.js`):

- `ledger_head_hash` — the SHA-256 of the last event in the chain at
  creation time.
- `event_count` (equivalently, the last `seq`).
- `created_at` — an ISO-8601 timestamp set by the signer at creation time.
- `tii_checkpoint` / `tii_signed_checkpoint` (`CHECKPOINT_FORMAT` in
  `src/checkpoint.js`, currently `"1"`) — the **checkpoint's own schema
  format version**, so a future change to the checkpoint's structure is
  distinguishable from a corrupted one. This is not a specification
  version and is never compared against `SPEC.md` or any identifier
  profile's version number.
- `spec_version` (default `"0.1.0"`, set in `src/checkpoint-store.js`) —
  **the overall TII system specification's version, i.e. `SPEC.md`'s own
  "Specification version" field, at the moment the checkpoint was
  created.** It is unrelated to, and not comparable with, the separately
  versioned identifier syntax profile
  (`spec/identifier-syntax-1.0-candidate.md`, currently `1.0`, frozen) —
  see `SPEC.md`'s own header note for the full explanation of why these
  are two independent version numbers, not one document with conflicting
  versions. A checkpoint's `spec_version` reading `"0.1.0"` while an
  issued identifier's own recorded content says "issued under TII 1.0"
  is expected and correct, not an inconsistency: the two labels describe
  different documents.
- `signing_key_id` — a fingerprint of the Ed25519 public key used, allowing
  verification against the correct key after rotation.

It never binds transient UI state, request metadata, or rendered HTML — the
signature is computed over the RFC 8785 JCS canonical form of exactly those
fields (`src/jcs.js`), which is kept as its own module, independent of the
ledger's own event-hashing canonicalization (`src/canonical.js`). The two
canonicalizers exist for different purposes and are not interchangeable: the
ledger's is for the append-only hash chain, JCS is for what gets signed.

## Storage format

Checkpoints are portable files, one per checkpoint, under a configurable
directory (`TII_CHECKPOINT_DIR`, default `checkpoints/` at the repo root).
Each file is self-contained JSON: the five attested fields, the Ed25519
signature (base64), and the signer's public key / key id. A checkpoint file
can be copied off the server, published independently, mirrored, or diffed
by hand — verification (`checkpointStore.verifyCheckpoint`) needs only the
checkpoint file, the signer's public key (or the on-disk keyset), and a
ledger to check against. It does not require Vercel, the UI, the live Node
process, or any network access. `checkpoints/` is listed in `.gitignore`
(checkpoints are operational state, generated per-deployment, not part of
the committed record — see §Key handling).

## Checkpoint policy chosen: every successful write, best-effort

Three policies were considered:

1. **Manual only** (`tii checkpoint create` run by an operator) — maximum
   control, but the ledger can drift arbitrarily far from its last signed
   state between runs, widening the undetected-forgery window.
2. **Scheduled** (e.g. cron every N minutes) — bounds the drift window to a
   fixed interval, independent of write volume, but requires external
   scheduling infrastructure this phase does not add.
3. **Every successful authoritative write** (chosen) — `maybeAutoCheckpoint()`
   in `src/server.js` is called after every successful `issueTII`/`append`
   that isn't an idempotent replay. It is best-effort and non-blocking: if no
   signing key is configured, or checkpoint creation throws for any reason,
   the mutation still succeeds and the failure is logged
   server-side — never surfaced as a write failure to the caller. This keeps
   the drift window as small as possible (auditability preferred over raw
   write throughput per the task's explicit instruction), while never making
   checkpointing a single point of failure for ordinary writes.

Manual `tii checkpoint create` remains available and is what the CLI-only /
no-server workflow uses.

## Key handling

- **No private key is ever committed to git.** `checkpoints/` and any
  `*.private.pem` are gitignored.
- `resolveSigningKey(env)` (`src/checkpoint-store.js`) resolves a private key
  from, in order: `TII_CHECKPOINT_PRIVATE_KEY` (PEM contents directly, for
  environments like Vercel where only env vars are available) or
  `TII_CHECKPOINT_PRIVATE_KEY_FILE` (a path to a PEM file, for local/test
  use). If neither is set, it returns `null` — **it never generates a key**.
- **The PEM may be passphrase-encrypted** (`-----BEGIN ENCRYPTED PRIVATE
  KEY-----`) — the production custody correction added in
  `spec/production-key-custody.md` §8.5. When it is, a passphrase MUST also
  resolve via `TII_CHECKPOINT_KEY_PASSPHRASE` (text) or
  `TII_CHECKPOINT_KEY_PASSPHRASE_FILE` (a file path, e.g. a mounted secret),
  or `resolveSigningKey()` returns `null` — an encrypted key is never
  attempted without a passphrase, and a wrong passphrase also resolves to
  `null` rather than throwing. Unencrypted PEMs (every test/disposable key
  in this codebase's own test suite) are unaffected and load exactly as
  before — the passphrase step only engages when the key itself is
  encrypted. The decrypted key is held only in process memory (re-exported
  to a plain PEM string in memory) and is never written back to disk.
- **If no signing key is configured: reads continue** (`tii checkpoint
  verify`, `tii status`, `GET /status`, `GET /checkpoint/verify`, and the
  Audit page all work and correctly report `MISSING`/`UNVERIFIED` as
  appropriate), but **checkpoint creation fails closed** —
  `createCheckpoint()` throws `NoSigningKeyError` (`code: 'no-signing-key'`),
  which `src/server.js` maps to HTTP `409`, and the CLI (`tii checkpoint
  create`) exits non-zero with a clear message. There is no fallback that
  silently produces an unsigned "checkpoint" or silently mints a new
  production key on startup — both are explicitly forbidden by the task and
  neither occurs anywhere in this code.
- `tii checkpoint keygen [--out-dir DIR]` explicitly generates a new Ed25519
  keypair and writes the private key with file mode `0o600`, printing an
  explicit warning never to commit it. Key generation is always operator-
  invoked; nothing generates a key as a side effect of any other command.
- **Public-key export**: `keygen` also writes the public key PEM alongside
  the private key. `recordPublicKeyInKeyset()` appends `{key_id,
  public_key_pem, created_at}` to a `keyset.json` in the checkpoint
  directory, so verification can proceed even after key rotation without
  needing the original signer's environment.
- **Key rotation**: generate a new keypair, start signing new checkpoints
  with it (a new `TII_CHECKPOINT_PRIVATE_KEY_FILE`), and optionally
  `revokeKey(dir, keyId, revokedAt)` the old one. Revoking a key does **not**
  invalidate checkpoints it already signed — `verifyCheckpoint()` still
  validates a historical checkpoint against the key that was valid *at the
  time it was created*, using the on-disk keyset (`test/checkpoint-store.test.js`
  test E). Revocation only marks that key as no longer eligible to sign *new*
  checkpoints.

- **Production key status (2026-09-13):** a production signing key exists
  and is ACTIVE FOR CHECKPOINT SIGNING — key ID `1486de6152baec7f`
  (Ed25519, passphrase-encrypted PKCS8; see
  `spec/production-key-custody.md` §8.7 for the full ceremony record and
  the two retired candidates, `1b96b82d535afc95` and `46b11023f849e931`,
  that preceded it and were never activated). This is a statement about
  checkpoint-signing capability only — it does not by itself enable
  production TII issuance, which remains a separate condition gated by
  `src/production-gate.js` and is currently DISABLED.

## Commands

```
tii checkpoint create [--dir DIR]      # sign the current ledger head; fails closed with no key
tii checkpoint verify [--dir DIR] [--file FILE]
tii checkpoint list [--dir DIR]
tii checkpoint keygen [--out-dir DIR]  # explicit; never automatic
```

`GET /status`, `GET /checkpoint/verify`, `GET /checkpoint/list` expose the
same operations over HTTP; `GET /audit` renders both claims for a human
reader.

## What this does not claim

A `VERIFIED` checkpoint with `matches_current_head: true` means: the ledger's
current head is exactly the head an operator with the signing key attested
to, at the time named in the checkpoint. It does not mean the *content of
individual events* is true, that the recorder was honest, or that no event
recorded before that checkpoint was itself disputed/corrected through the
normal append-only revision model — those are separate, ordinary parts of
TII's record model (see SPEC.md) and are unaffected by checkpointing.
