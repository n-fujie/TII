'use strict';

/**
 * CANDIDATE signed-checkpoint design — NOT WIRED IN.
 *
 * Supporting code for the freeze audit (spec/freeze-audit.md §E). Not imported
 * by the running system. Provides an append-only-friendly way to prove *who*
 * attested to a ledger head, without a blockchain.
 *
 *   ledger events → SHA-256 chain → periodic checkpoint → Ed25519 signature
 *   → signed checkpoint published as ordinary files in independent locations
 *
 * Ed25519 via node:crypto (RFC 8032). No third-party crypto, no invented
 * algorithm.
 *
 * CANONICALIZATION — normative rule:
 *   checkpoint signing input = UTF-8 bytes of the RFC 8785 (JSON Canonicalization
 *   Scheme, JCS) canonicalization of the checkpoint JSON object.
 * This is deliberately SEPARATE from the historical ledger hash-chain
 * canonicalization (src/canonical.js), which is unchanged and not migrated.
 * JCS gives property-order, whitespace and representation independence and
 * rejects duplicate property names — the properties a cross-implementation
 * verifier needs. Rendered HTML is never signed.
 */

const crypto = require('node:crypto');
const { stripUndefined } = require('../canonical');
const jcs = require('./jcs');

const CHECKPOINT_FORMAT = '1';
const ALGORITHM = 'ed25519';

/* ------------------------------------------------------------- keypairs --- */

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { publicKeyPem, privateKeyPem, keyId: keyId(publicKeyPem) };
}

/** Stable, non-secret key identifier: first 16 hex of SHA-256 over the SPKI DER. */
function keyId(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/* --------------------------------------------------------- checkpoints --- */

/**
 * Bind the minimum that a checkpoint must attest to. `extra` may carry
 * interpretation / spec-version notes but nothing that would make the format
 * unstable.
 */
function buildCheckpoint({ ledgerHeadHash, eventCount, specVersion, createdAt, extra }) {
  if (!ledgerHeadHash || typeof eventCount !== 'number') {
    throw new Error('buildCheckpoint requires ledgerHeadHash and numeric eventCount');
  }
  return stripUndefined({
    tii_checkpoint: CHECKPOINT_FORMAT,
    ledger_head_hash: ledgerHeadHash,
    event_count: eventCount,
    created_at: createdAt || new Date().toISOString(),
    spec_version: specVersion || null,
    extra: extra || undefined,
  });
}

/** Deterministic bytes that get signed / verified: RFC 8785 JCS, UTF-8. */
function checkpointBytes(checkpoint) {
  return Buffer.from(jcs.canonicalize(checkpoint), 'utf8');
}

function signCheckpoint(checkpoint, privateKeyPem, opts = {}) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, checkpointBytes(checkpoint), key).toString('base64');
  const publicKeyPem =
    opts.publicKeyPem ||
    crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  return {
    tii_signed_checkpoint: CHECKPOINT_FORMAT,
    algorithm: ALGORITHM,
    canonicalization: 'RFC8785-JCS',
    key_id: opts.keyId || keyId(publicKeyPem),
    public_key: publicKeyPem,
    checkpoint,
    signature,
  };
}

/**
 * Verify a signed checkpoint.
 *
 * With no `keyset`, the embedded `public_key` is used (self-describing file).
 * With a `keyset` (array of { key_id, public_key_pem, not_before, not_after }),
 * the key is resolved by `key_id`, the embedded key must match it, and
 * `checkpoint.created_at` must fall inside that key's validity window — so a
 * later key rotation never invalidates an older signature.
 */
function verifySignedCheckpoint(signed, opts = {}) {
  try {
    if (!signed || signed.algorithm !== ALGORITHM) return fail('bad-algorithm');
    if (!signed.checkpoint || !signed.signature) return fail('malformed');
    let publicKeyPem = signed.public_key;

    if (opts.keyset) {
      const entry = opts.keyset.find((k) => k.key_id === signed.key_id);
      if (!entry) return fail('unknown-key');
      if (entry.revoked_at && signed.checkpoint.created_at >= entry.revoked_at) {
        return fail('key-revoked-before-checkpoint');
      }
      if (entry.not_before && signed.checkpoint.created_at < entry.not_before) {
        return fail('checkpoint-before-key-validity');
      }
      if (entry.not_after && signed.checkpoint.created_at > entry.not_after) {
        return fail('checkpoint-after-key-validity');
      }
      if (keyId(entry.public_key_pem) !== signed.key_id) return fail('keyset-key-id-mismatch');
      if (publicKeyPem && keyId(publicKeyPem) !== signed.key_id) return fail('embedded-key-id-mismatch');
      publicKeyPem = entry.public_key_pem;
    }

    if (!publicKeyPem) return fail('no-key');
    const ok = crypto.verify(
      null,
      checkpointBytes(signed.checkpoint),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(signed.signature, 'base64')
    );
    return ok ? { ok: true, key_id: signed.key_id } : fail('bad-signature');
  } catch (e) {
    return fail('exception:' + e.message);
  }
}

function fail(reason) {
  return { ok: false, reason };
}

/* ----------------------------------------------------- file portability --- */

/**
 * Serialize to a plain UTF-8 JSON file body. The on-disk form MAY be
 * pretty-printed; it is not the signing input (that is JCS of `.checkpoint`),
 * so whitespace in the file does not affect verification.
 */
function serialize(signed) {
  return JSON.stringify(signed, null, 2) + '\n';
}

/**
 * Parse a checkpoint file. Uses the JCS strict parser, which rejects duplicate
 * property names (RFC 8785 §3.1) before the content is ever verified.
 */
function deserialize(text) {
  return jcs.parse(text);
}

module.exports = {
  CHECKPOINT_FORMAT,
  ALGORITHM,
  generateKeypair,
  keyId,
  buildCheckpoint,
  checkpointBytes,
  signCheckpoint,
  verifySignedCheckpoint,
  serialize,
  deserialize,
};
