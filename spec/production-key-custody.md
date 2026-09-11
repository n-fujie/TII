# Production Signing-Key Custody Model

> **No production signing key exists.** This document prepares the
> key-custody model and key-generation procedure. **No key generation was
> executed by this task** beyond the disposable, throwaway keys used inside
> automated tests (`test/production-gate.test.js`, `test/checkpoint-store.test.js`
> — each generated under `os.tmpdir()` and discarded when the test process
> exits; none are retained, none are a production key).

## 1. What the checkpoint signing key is, and is not

- **The signing key is an operational verifier authority — not the identity
  of any TII.** Changing the key changes nothing about any issued
  identifier (`spec/checkpoint-operation.md`, `spec/single-writer-model.md`
  reaffirm the same principle for the writer lock; the same discipline
  applies here). See §5 below for how historical verification survives
  rotation.
- It attests checkpoints (ledger head + event count + timestamp + format +
  key id) — it does not sign individual TII issuance events, does not sign
  rendered HTML, and is not consulted by `Ledger.append()` or `verify()` at
  all (those use only the SHA-256 hash chain, unrelated to this key).

## 2. The five things kept distinct (never collapsed)

| Concept | What it is | Where it lives |
|---|---|---|
| **Signing private key** | Ed25519 private key, PKCS8 PEM | Never in git. Local file or env var only, restricted permissions (`0o600`) — `src/checkpoint-store.js` `resolveSigningKey()`. |
| **Verification public key** | Ed25519 public key, SPKI PEM | Embedded in every checkpoint file (self-describing) AND recorded in `checkpoints/keyset.json` (public keys only). Safe to publish anywhere. |
| **Key identifier** | First 16 hex chars of SHA-256(public key DER) — `src/checkpoint.js` `keyId()` | Non-secret, stable, used to resolve which key signed which checkpoint after rotation. |
| **Checkpoint records** | Signed JSON files, one per checkpoint | `checkpoints/` (gitignored), portable, may be copied/published independently. |
| **Key rotation/revocation metadata** | `{key_id, public_key_pem, not_before, revoked_at}` entries | `checkpoints/keyset.json` — public data, safe to publish, appended to (not secretly held). |

## 3. Private key handling — hard requirements (already enforced in code, restated here as policy)

The private key must **never** be:

- **committed to Git** — `checkpoints/` and `*.private.pem` are in
  `.gitignore` (added in production-hardening Phase 1); `resolveSigningKey()`
  only ever reads from an env var or an operator-specified file path, never
  from anything checked into the repository.
- **written to the ledger** — no code path in `src/ledger.js` ever touches
  key material; the ledger and the checkpoint subsystem are entirely
  separate modules communicating only through `Ledger.verify().head_hash`
  and `.event_count`.
- **included in exports** — `src/export.js`'s `toJSON`/`toJSONL`/`toCSV`/
  `buildStaticSite` never reference `src/checkpoint-store.js` or any key
  material; verified by `test/admin-security.test.js` test L (static
  deployment) and the Phase 1 adversarial verification's item 17 (static
  mirror validation, which built a static site alongside a real key file on
  disk and grepped the output tree for `BEGIN PRIVATE KEY` — none found).
- **copied to the static mirror** — same evidence as above.
- **exposed in any API response** — no HTTP route in `src/server.js` reads
  or returns key material; `GET /status`/`GET /checkpoint/*` report only
  `checkpoint_signing_key_configured: true/false` (a boolean) and the
  public `key_id`, never the key itself.
- **rendered in HTML** — no view in `src/views.js` references key material.
- **logged** — `src/server.js`'s startup log reports only whether a key is
  configured (`"configured"` / `"NOT configured"`), never its value or path
  contents; `maybeAutoCheckpoint()`'s error handler logs only `e.message`
  on failure, never key bytes.

## 4. Key-generation procedure (documented; not executed for production in this task)

`tii checkpoint keygen [--out-dir DIR]` (`bin/tii.js`, wired since
production-hardening Phase 1) is the mechanism:

1. **Generation.** `crypto.generateKeyPairSync('ed25519')` — Node's built-in
   CSPRNG-backed Ed25519 implementation (RFC 8032). No third-party crypto
   library, no custom RNG.
2. **Where the private key is stored.** Written to a local file with mode
   `0o600` (owner read/write only) at an operator-chosen path — never a
   path under version control. For an actual production launch, this
   SHOULD instead be:
   - generated **offline**, on a machine not connected to the production
     deployment, and transferred to the production environment's secret
     store (e.g. the hosting platform's encrypted environment-variable
     store) via `TII_CHECKPOINT_PRIVATE_KEY` (PEM text as an env var,
     already supported by `resolveSigningKey()`) rather than a file on the
     production host; or
   - generated inside a hardware security module / cloud KMS with
     Ed25519 support, if the operational scale later justifies it (not
     required for initial launch).
3. **Backup.** At minimum two independent, encrypted copies (e.g. a
   password-manager vault entry and an offline encrypted USB/paper backup),
   held by **at least two** separate steward representatives — a single
   point of failure in key custody is itself a launch risk (see
   `succession-manifest.md`). Never back up to the same account/service as
   the resolver domain or hosting credentials (correlated compromise risk).
4. **Who may access it.** The smallest practical set of accountable
   individuals under the current steward (`governance-candidate.md`); this
   task does not name specific individuals (see G8 — governance identity is
   UNRESOLVED).
5. **How the public key is published.** `recordPublicKeyInKeyset()`
   (`src/checkpoint-store.js`) appends `{key_id, public_key_pem,
   not_before}` to `checkpoints/keyset.json` automatically on every
   `createCheckpoint()` call; the public key is also self-embedded in every
   checkpoint file. For maximum reach, the public key SHOULD additionally
   be published on the specification site once the permanent domain exists
   (`resolver-domain-decision.md`), and optionally mirrored to an
   independent location the operator does not solely control (see
   `spec/phase1-adversarial-verification.md` L3 — this is exactly what
   turns a checkpoint from "signed" into something closer to
   "independently checkable").
6. **How rotation works.** Generate a new keypair (step 1), start signing
   new checkpoints with it, and `revokeKey(dir, oldKeyId, revokedAt)`
   (`src/checkpoint-store.js`) the old one. Revoking does **not** invalidate
   checkpoints the old key already signed — `verifySignedCheckpoint()`
   checks a checkpoint's `created_at` against the key's validity window
   (`not_before`/`revoked_at`), so a genuinely historical signature stays
   verifiable (`test/checkpoint-store.test.js` test E). See §5.
7. **How compromise is declared.** An operator who suspects a key is
   compromised:
   1. generates a new keypair immediately (step 1) and starts signing with
      it;
   2. calls `revokeKey()` for the compromised key with `revokedAt` set to
      the **best estimate of the compromise time** (not necessarily "now"
      — see the limitation in §6 below);
   3. publishes the revocation (the updated `keyset.json`) as widely as the
      public key was published;
   4. reviews every checkpoint signed by that key between its
      `not_before` and the declared `revokedAt` with elevated suspicion —
      the compromise declaration cannot, by itself, prove which of those
      checkpoints (if any) were forged, only bound the window.

## 5. Rotation preserves historical verification (already implemented and tested)

`verifySignedCheckpoint()` (`src/checkpoint.js`) resolves the signer by
`key_id` against a keyset entry with `not_before`/`revoked_at` validity
bounds, not by "is this the CURRENT key." A checkpoint signed by key A in
2026, verified in 2028 after rotation to key C, still reports `VERIFIED` as
long as key A's keyset entry is retained (never deleted, only marked
revoked). This is the mechanism by which "changing the key does not change
any TII" is upheld operationally, not just as a policy statement.

## 6. Key-compromise limitation — preserved from adversarial verification, not solved here

> A compromised historical signing key may be used to create a **newly
> signed checkpoint with a misleadingly historical `created_at` timestamp**
> — the signature proves the byte content was signed by that key; it does
> **not** and cannot prove *when* the signing operation actually happened.
> `verifySignedCheckpoint()`'s revocation check trusts `created_at`, a field
> inside the very content the (possibly compromised) key signs. Confirmed
> empirically in `spec/phase1-adversarial-verification.md` §4/L2: a
> checkpoint backdated to before a key's revocation, forged with the
> compromised key, verifies identically to a genuine historical checkpoint.

**This is not fixed and is not claimed fixed.** Fixing it requires an
independent trusted timestamp (RFC 3161 TSA, a transparency log, or a
timely third-party witness countersignature) — explicitly out of scope to
invent here (per this task's own instruction) and listed as future,
optional work in §7/§9 of `spec/checkpoint-operation.md`'s trust-layer
discussion and `spec/production-launch-gate.md` §15.

**Do not claim trusted timestamping. Do not claim immutable historical
existence.** TII 1.0's checkpoints provide **signed-head authenticity**,
not **independent temporal anchoring** — see
`spec/phase1-adversarial-verification.md` §1's three-property
classification, restated in `spec/production-launch-gate.md` §15.
