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

---

## 7. External Infrastructure Closure — G3 (2026-09-11)

### 7.1 Storage options compared

| Option | Confidentiality | Recoverability | Portability | Vendor dependence | Automated-signing compatibility | Operator complexity | Accidental Git-inclusion risk |
|---|---|---|---|---|---|---|---|
| **A. Encrypted offline file** (e.g. age/GPG-encrypted PEM on a disconnected machine) | High, if the passphrase/recipient key is itself well-custodied | Manual — someone must decrypt and load it | High — plain file, no vendor format | None | Requires a manual/scripted decrypt-and-load step for the checkpoint process | Low | Low, if kept outside any repo working directory by convention (already enforced by `.gitignore` for anything that DOES end up near the repo — see §3 above) |
| **B. Encrypted removable/offline backup** (USB/paper, encrypted) | High | Physical retrieval required — intentionally slow | High | None | Not directly automatable (by design — this is the *recovery* copy, not the operational one) | Low–moderate (physical custody discipline) | None (never touches a working directory) |
| **C. OS/platform secret store** (macOS Keychain, systemd-creds, cloud provider's encrypted env-var store) | Depends on the platform's own protections | Good if the platform account survives; poor if it doesn't | Low–moderate — often platform-specific | Moderate–high | Good — most support direct env-var injection, matching `TII_CHECKPOINT_PRIVATE_KEY` | Low | Low |
| **D. Managed KMS/HSM** (cloud KMS, hardware HSM) | Highest — key material may never leave the device | Depends entirely on the vendor's own recovery/export policy (some HSMs deliberately make export impossible, which is a *different* risk — see below) | Low — vendor-specific integration | High | Requires an HSM-aware signing integration; `crypto.sign()` in `src/checkpoint.js` currently takes a PEM private key directly, not an HSM handle — **would require a code change not made in this task** | Moderate–high | None |

### 7.2 Recommendation for current scale

**Option A (operational) + Option B (offline recovery), i.e. the two-copy
model already described in §3 above, is recommended for initial
production.** Option D (managed KMS/HSM) is explicitly **not required
merely for appearance** — at TII's current scale (a single authoritative
writer, checkpoint-per-mutation policy already bounding the exposure
window per `spec/checkpoint-operation.md`), an HSM adds vendor dependence
and a code-integration requirement this task does not make, without a
correspondingly large reduction in real risk. Option C (platform secret
store) is a reasonable choice for the *operational* copy specifically if
the production host's platform offers one with good recoverability
properties — it is not a substitute for an independent offline backup
(Option B), which must never live in the same account or vendor as the
operational copy (§3 step 3, restated below).

### 7.3 Recommended initial key model (confirmed, two-copy)

```
Operational signing copy   -> Option A or C, reachable only by the
                               authoritative checkpoint process
                               (TII_CHECKPOINT_PRIVATE_KEY_FILE or
                               TII_CHECKPOINT_PRIVATE_KEY)
Offline recovery copy      -> Option B, encrypted, held by a DIFFERENT
                               person/account than the operational copy,
                               in a DIFFERENT vendor/service than wherever
                               the operational copy or the domain/registrar
                               credentials live (see the bus-factor audit,
                               spec/succession-manifest.md §Bus-Factor, for
                               why "different vendor" specifically matters)
Public verification key    -> published openly (checkpoints/keyset.json,
                               and eventually the specification site)
```

**Do not store the only private-key copy on the production server.** (The
operational copy IS on/reachable-by the production server by necessity —
"only copy" is the violation, not "a copy exists there.") **Do not store
the only backup in the same cloud account as the operational copy or as
the domain/registrar account** — a single compromised account must not be
able to reach both the operational key and its own backup, or the
"backup" provides no real protection against exactly the account-level
compromise it exists to survive.

### 7.4 Key-generation ceremony — restated precisely (still not executed)

1. Clean, disconnected-from-production environment (ideally offline).
2. `crypto.generateKeyPairSync('ed25519')` — Ed25519, no alternative
   algorithm.
3. Derive the key identifier: `keyId()` (`src/checkpoint.js`) — first 16
   hex chars of SHA-256 over the public key's SPKI DER encoding.
4. Encrypt the private key material for storage (Option A/B/C per §7.2).
5. Write the offline backup copy (Option B) to physically/logically
   separate storage from the operational copy.
6. Export and publish the public key (`recordPublicKeyInKeyset()`,
   automatic on first `createCheckpoint()` call — or manually via `tii
   checkpoint keygen`'s `public_key_file` output).
7. **Verification test:** `crypto.verify()` round-trip against a test
   payload — confirms the exported public key actually matches the
   private key before relying on either copy.
8. **Checkpoint test:** create one checkpoint against a **disposable, non-
   canonical test ledger** (never `data/ledger.jsonl`) and verify it —
   confirms the full `src/checkpoint-store.js` path works end to end with
   this specific key before it is ever used for anything real.
9. **Destroy every temporary plaintext copy** — any unencrypted PEM that
   existed transiently during generation/encryption (shell history,
   temp files, clipboard) — before the ceremony is considered complete.
10. **Custody record:** who generated it, when, where the operational and
    backup copies live (by reference/description, never the key material
    itself), and who holds access to each — feeds
    `spec/succession-manifest.md`'s bus-factor audit.

**Not executed for a production key by this task.**

### 7.5 Key-loss model (loss, not compromise — a different scenario from §6 above)

Modeled: the active operational private key is destroyed (device failure,
accidental deletion) with no compromise suspected.

| Property | Result |
|---|---|
| Ledger remains readable | **Yes** — `Ledger.load()`/`verify()` never touch key material |
| Old checkpoints remain verifiable | **Yes** — `verifySignedCheckpoint()` needs only the (already-public) public key and keyset, never the private key |
| New checkpoint creation stops | **Yes** — `checkpointStore.resolveSigningKey()` returns `null`, `createCheckpoint()` throws `NoSigningKeyError`, fails closed (unchanged, verified: `test/checkpoint-store.test.js` test D) |
| Production mutation gate fails closed | **Yes** — `signing_ready: false` blocks `src/production-gate.js`'s AND gate immediately; `checkpoint_current` also becomes unsatisfiable with no key (verified: `test/production-gate.test.js` §7 "flag true but signing key unavailable") |
| Recovery from backup is possible if backup exists | **Yes** — restore the offline copy (§7.3) as the new operational copy; no ledger or checkpoint state needs to change |
| If no backup exists | A **new key must be generated** (§7.4) and is a **different key** — the old key's `key_id` stops signing new checkpoints. This requires an explicit governance/key-transition record (a recorded event, e.g. under the same `stewardship.transferred`-style discipline as `spec/succession-policy.md` §3, or a dedicated key-transition note) — **never a silent, unannounced switch.** Every checkpoint signed by the lost key remains verifiable (the keyset entry is never deleted, only ever marked revoked/superseded); only the ABILITY to sign NEW checkpoints with that specific key is gone. |

**No code in this repository silently generates a replacement signing
authority.** `resolveSigningKey()` returns `null`, never a freshly minted
key, when nothing is configured (unchanged since production-hardening
Phase 1, reconfirmed by code inspection this phase).

### 7.6 Signing-failure production policy — re-tested this phase

Re-ran `test/production-gate.test.js`'s "§17 if checkpoint creation fails
after a committed production mutation..." test in this phase's session
(unchanged from the prior phase, still passing): a committed production
mutation is never rolled back; checkpoint state is surfaced as `FAILED`,
never hidden; further production mutations are blocked via the
`checkpoint_current` gate condition; operator recovery (re-running
`checkpointStore.createCheckpoint()`) restores availability without
touching already-written history. **Policy frozen, unchanged, reconfirmed
working.**

### 7.7 G3 status (as of the prior phase)

**CONDITIONAL PASS.** The custody model, storage-option comparison,
generation ceremony, key-loss model, and signing-failure policy were all
fully specified and (where testable without a real key) verified. **No
production key existed.** See §8 for the ceremony that has since run.

## 8. Key ceremony executed (2026-09-12)

The human operator gave explicit authorization for key generation
(J: NOT AUTHORIZED → AUTHORIZED). The ceremony ran using the existing,
unmodified `generateKeypair()`/`keyId()` functions from `src/checkpoint.js`
— no new key format was invented.

### 8.1 What was generated and verified

- **Algorithm:** Ed25519 (no substitute algorithm needed or used).
- **Key identifier:** `1b96b82d535afc95` (first 16 hex chars of
  SHA-256 over the SPKI DER of the public key — the existing, unchanged
  derivation in `src/checkpoint.js` `keyId()`).
- **Public key SHA-256:** `0bd0868ad0dd146e1046e1c7ad9de7d3a3e8b33901ae9e214f918c203b20d8d7`
  (a fingerprint of the PEM text itself, for out-of-band cross-checking;
  distinct from the key identifier above, which fingerprints the DER).
- **Signing test:** PASS — the key signed a test checkpoint against a
  disposable test ledger (never the canonical ledger).
- **Verification test:** PASS — the signature verified correctly, and the
  resolved `key_id` matched.
- **Tamper tests (4/4 correctly rejected):** altering the attested head
  hash, event count, checkpoint timestamp, and checkpoint body (spec
  version) each independently caused verification to fail with
  `bad-signature` — exactly the required behavior.
- **Environment:** generated on the operator's own persistent local
  machine (confirmed not ephemeral — a real, named Mac with FileVault
  full-disk encryption enabled), not inside the public Vercel deployment,
  not in a static-build environment, not in a browser, not through any
  third-party key-generation service.
- **Canonical ledger:** untouched — the sign/verify/tamper tests ran
  against a disposable ledger created under the OS temp directory and
  deleted immediately after.

### 8.2 The passphrase boundary — genuine, not a formality

This agent has **no mechanism for hidden input** — every Bash command it
runs, and every argument in it, is visible in its own output. Per the
ceremony's own rule ("if an interactive hidden passphrase prompt is
available, use it; otherwise STOP and request human takeover... do not
invent a passphrase automatically"), the agent generated the raw keypair
(which needs no passphrase) and the plaintext private key was written,
restrictively permissioned (`0600`, directory `0700`), to a staging
location **outside the git repository**
(`~/.tii-production-key-ceremony/`) — then the agent stopped and handed
the encryption step to the human operator, exactly as required.

### 8.3 Operational vs. recovery copy — a resolved design tension, stated plainly

The custody model calls for an *encrypted* operational copy, but the
**existing, unmodified** `resolveSigningKey()` in `src/checkpoint-store.js`
reads a plain PKCS8 PEM file directly — it has no passphrase-decryption
step, and adding one would be a code change this ceremony does not make.
Rather than silently ignore this gap or silently modify accepted code,
it is resolved as follows, and recorded here so it is never assumed away:

- **Operational copy:** stored as a plain PEM file, protected by
  filesystem permissions (`0600`, owner-only) and the host's full-disk
  encryption (FileVault, confirmed **On** on the generation machine) —
  "encrypted at rest" via the disk, not a per-read passphrase, because the
  automated checkpoint-signing process must be able to read it
  unattended, exactly matching how `resolveSigningKey()` already works.
- **Recovery copy:** passphrase-encrypted (`openssl pkcs8 -topk8 -v2
  aes-256-cbc`, a standard, auditable, non-invented format), because it is
  **not** read automatically — a human is always present when an actual
  disaster-recovery decryption happens, so a passphrase prompt there costs
  nothing operationally and adds real protection for a copy that, by
  design, is not sitting behind the same host's disk encryption.

### 8.4 What remains — human action required (§13 of the ceremony)

**G3 remains CONDITIONAL PASS.** Per the ceremony's own rule: it becomes
PASS only once the human confirms the independent, separately-located
encrypted recovery copy exists. The exact remaining steps (recovery-copy
encryption, its placement in a genuinely separate location, and moving
the plaintext into its permanent operational home) were handed to the
human operator with exact commands and a checksum to verify against —
see the ceremony's final report for the precise instructions. This agent
did not, and structurally cannot, perform the passphrase-entry or
physical/logical offline-placement steps itself.

**No secret material was committed, logged, or exposed in chat.** The
plaintext staging file's SHA-256 (`d2b9520fb40d2ce0aace5c1267d6e3748a9af13e767fb3a201750fa68b724097`)
is recorded here only so the human can confirm, after encrypting, that
the bytes that went into the encrypted copies match what was actually
generated — this checksum reveals nothing about the key's content.
