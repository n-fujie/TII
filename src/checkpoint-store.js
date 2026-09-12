'use strict';

/**
 * Live operational layer for signed checkpoints (production-hardening Phase 1,
 * P0-A, spec/checkpoint-operation.md). Wires the pure crypto in src/checkpoint.js
 * to: key resolution (env-only, never auto-generated), a portable checkpoints/
 * directory, and create/list/verify operations used by bin/tii.js, src/server.js,
 * and the Audit page.
 *
 * KEEPS TWO CLAIMS SEPARATE (never collapse into one "verified"):
 *   A. Ledger chain integrity — Ledger.verify(): VALID / INVALID.
 *   B. Signed checkpoint      — verifyCheckpoint() below:
 *        VERIFIED   — signature checks out against a known key.
 *        UNVERIFIED — a checkpoint exists but no key is available to check it.
 *        INVALID    — signature/content check failed against a known key.
 *        MISSING    — no checkpoint file exists at all.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ckpt = require('./checkpoint');

class NoSigningKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoSigningKeyError';
    this.code = 'no-signing-key';
  }
}

/**
 * Resolve an optional decryption passphrase for a passphrase-encrypted PKCS8
 * private key (spec/production-key-custody.md §8.5 — the G3 custody
 * correction). Most TEST/disposable keys are NOT encrypted and this
 * correctly resolves to `undefined` for them — nothing about existing
 * unencrypted-key usage changes.
 *
 *   TII_CHECKPOINT_KEY_PASSPHRASE       passphrase text — for secret-manager-injected env vars
 *   TII_CHECKPOINT_KEY_PASSPHRASE_FILE  path to a file containing the passphrase (e.g. a mounted secret)
 *
 * Never logged, never returned to any caller other than the key-parsing step
 * immediately below, never written anywhere.
 */
function resolvePassphrase(env) {
  if (env.TII_CHECKPOINT_KEY_PASSPHRASE) return Buffer.from(env.TII_CHECKPOINT_KEY_PASSPHRASE, 'utf8');
  if (env.TII_CHECKPOINT_KEY_PASSPHRASE_FILE) {
    if (!fs.existsSync(env.TII_CHECKPOINT_KEY_PASSPHRASE_FILE)) return undefined;
    return Buffer.from(fs.readFileSync(env.TII_CHECKPOINT_KEY_PASSPHRASE_FILE, 'utf8').replace(/\r?\n$/, ''), 'utf8');
  }
  return undefined;
}

/**
 * Resolve a signing keypair from the environment ONLY. Never generates or
 * persists a key on its own — that would be exactly the "silently generate a
 * new production key on startup" behaviour this phase forbids. Returns `null`
 * (not a throw) when unconfigured OR when the configured key cannot be
 * loaded for any reason (missing file, malformed PEM, wrong/missing
 * passphrase for an encrypted key) — every failure mode fails closed through
 * this single return path, never an uncaught exception.
 *
 *   TII_CHECKPOINT_PRIVATE_KEY       PEM text — for env-injected deployments
 *   TII_CHECKPOINT_PRIVATE_KEY_FILE  path to a PEM file — for local/dev/test use
 *
 * The PEM may be an ordinary unencrypted PKCS8 key (unchanged behavior — this
 * is how every existing test's disposable/ephemeral key already works) OR a
 * passphrase-encrypted PKCS8 key (`-----BEGIN ENCRYPTED PRIVATE KEY-----`),
 * in which case a passphrase MUST also resolve via resolvePassphrase() above
 * — an encrypted key with no passphrase available is never attempted, never
 * silently treated as unencrypted. This is the production custody
 * correction from spec/production-key-custody.md §8.5: the production
 * operational copy is a passphrase-encrypted PKCS8 PEM, not a generally-
 * readable plaintext file — this function is the only place the passphrase
 * is ever used, and the decrypted key is held only in process memory
 * (re-exported to a plain PEM string in memory so the unchanged downstream
 * signing code in src/checkpoint.js — which still takes a plain PEM string —
 * never needs to know a passphrase was involved). Nothing here writes a
 * decrypted copy back to disk.
 */
function resolveSigningKey(env = process.env) {
  let privateKeyPemRaw = null;
  if (env.TII_CHECKPOINT_PRIVATE_KEY) {
    privateKeyPemRaw = env.TII_CHECKPOINT_PRIVATE_KEY;
  } else if (env.TII_CHECKPOINT_PRIVATE_KEY_FILE) {
    if (!fs.existsSync(env.TII_CHECKPOINT_PRIVATE_KEY_FILE)) return null;
    privateKeyPemRaw = fs.readFileSync(env.TII_CHECKPOINT_PRIVATE_KEY_FILE, 'utf8');
  }
  if (!privateKeyPemRaw) return null;

  const isEncrypted = /BEGIN ENCRYPTED PRIVATE KEY/.test(privateKeyPemRaw);
  const passphrase = resolvePassphrase(env);
  if (isEncrypted && !passphrase) return null; // fail closed: never attempted without one

  let keyObject;
  try {
    keyObject = isEncrypted
      ? crypto.createPrivateKey({ key: privateKeyPemRaw, format: 'pem', passphrase })
      : crypto.createPrivateKey(privateKeyPemRaw);
  } catch {
    return null; // malformed PEM, or wrong passphrase for an encrypted key -- fail closed, never throw
  }

  const privateKeyPem = keyObject.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = crypto.createPublicKey(keyObject).export({ type: 'spki', format: 'pem' }).toString();
  return { privateKeyPem, publicKeyPem, keyId: ckpt.keyId(publicKeyPem) };
}

function checkpointsDir(dir) {
  return dir || process.env.TII_CHECKPOINT_DIR || path.join(process.cwd(), 'checkpoints');
}

function keysetPath(dir) {
  return path.join(checkpointsDir(dir), 'keyset.json');
}

/** Public-key history for this store. Public keys only — never a private key. */
function loadKeyset(dir) {
  const p = keysetPath(dir);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function recordPublicKeyInKeyset(dir, entry) {
  const d = checkpointsDir(dir);
  fs.mkdirSync(d, { recursive: true });
  const list = loadKeyset(dir);
  if (!list.some((k) => k.key_id === entry.key_id)) {
    list.push(entry);
    fs.writeFileSync(keysetPath(dir), JSON.stringify(list, null, 2) + '\n');
  }
  return list;
}

/** Mark a keyset entry revoked (append-style: rewrite the small keyset file with revoked_at set). */
function revokeKey(dir, keyId, revokedAt = new Date().toISOString()) {
  const list = loadKeyset(dir).map((k) => (k.key_id === keyId ? { ...k, revoked_at: revokedAt } : k));
  fs.writeFileSync(keysetPath(dir), JSON.stringify(list, null, 2) + '\n');
  return list;
}

function checkpointFileName({ event_count, created_at }) {
  const compact = created_at.replace(/[:.]/g, '');
  const nonce = crypto.randomBytes(3).toString('hex');
  return `checkpoint-${String(event_count).padStart(10, '0')}-${compact}-${nonce}.json`;
}

/**
 * Create and persist a new signed checkpoint for the CURRENT state of `ledger`.
 * FAILS CLOSED: throws NoSigningKeyError if no signing key is configured.
 * Never falls back to an unsigned "checkpoint", never generates a key itself.
 */
function createCheckpoint(ledger, opts = {}) {
  const key = resolveSigningKey(opts.env);
  if (!key) {
    throw new NoSigningKeyError(
      'no checkpoint signing key configured — set TII_CHECKPOINT_PRIVATE_KEY or ' +
        'TII_CHECKPOINT_PRIVATE_KEY_FILE. No checkpoint was created.'
    );
  }
  const v = ledger.verify();
  const checkpoint = ckpt.buildCheckpoint({
    ledgerHeadHash: v.head_hash,
    eventCount: v.event_count,
    specVersion: opts.specVersion || '0.1.0',
    createdAt: opts.createdAt,
  });
  const signed = ckpt.signCheckpoint(checkpoint, key.privateKeyPem, { publicKeyPem: key.publicKeyPem, keyId: key.keyId });

  const dir = checkpointsDir(opts.dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, checkpointFileName(checkpoint));
  fs.writeFileSync(file, ckpt.serialize(signed));
  recordPublicKeyInKeyset(opts.dir, { key_id: key.keyId, public_key_pem: key.publicKeyPem, not_before: opts.notBefore || checkpoint.created_at });

  return { file, signed, ledger_chain_valid: v.ok };
}

function listCheckpoints(dir) {
  const d = checkpointsDir(dir);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.startsWith('checkpoint-') && f.endsWith('.json'))
    .sort()
    .map((f) => {
      const full = path.join(d, f);
      try {
        const signed = ckpt.deserialize(fs.readFileSync(full, 'utf8'));
        return {
          file: f,
          path: full,
          event_count: signed.checkpoint.event_count,
          created_at: signed.checkpoint.created_at,
          head_hash: signed.checkpoint.ledger_head_hash,
          key_id: signed.key_id,
        };
      } catch (e) {
        return { file: f, path: full, error: 'unreadable: ' + e.message };
      }
    });
}

function latestCheckpoint(dir) {
  const list = listCheckpoints(dir).filter((c) => !c.error);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Verify a checkpoint (latest by default, or `opts.file`) against a keyset —
 * and separately report whether it is up to date with the ledger's CURRENT
 * head. A stale-but-validly-signed checkpoint (new events since it was made)
 * is normal, not a forgery signal — the two facts are reported separately.
 */
function verifyCheckpoint(ledger, opts = {}) {
  const dir = checkpointsDir(opts.dir);
  const target = opts.file ? { file: opts.file, path: path.isAbsolute(opts.file) ? opts.file : path.join(dir, opts.file) } : latestCheckpoint(opts.dir);
  if (!target) return { status: 'MISSING', reason: `no checkpoint files found in ${dir}` };
  if (target.error) return { status: 'INVALID', reason: target.error, file: target.file };

  let signed;
  try {
    signed = ckpt.deserialize(fs.readFileSync(target.path, 'utf8'));
  } catch (e) {
    return { status: 'INVALID', reason: 'unreadable or malformed checkpoint file: ' + e.message, file: target.file };
  }

  const keyset = opts.keyset || loadKeyset(opts.dir);
  const sigResult = ckpt.verifySignedCheckpoint(signed, keyset.length ? { keyset } : {});
  if (!sigResult.ok) {
    if (sigResult.reason === 'no-key') {
      return { status: 'UNVERIFIED', reason: 'no public key available to check this checkpoint (no embedded key, no keyset)', file: target.file, checkpoint: signed.checkpoint };
    }
    return { status: 'INVALID', reason: sigResult.reason, file: target.file, checkpoint: signed.checkpoint };
  }

  const currentHead = ledger.verify().head_hash;
  const matchesCurrentHead = signed.checkpoint.ledger_head_hash === currentHead;
  return {
    status: 'VERIFIED',
    file: target.file,
    checkpoint: signed.checkpoint,
    key_id: signed.key_id,
    matches_current_head: matchesCurrentHead,
    current_head_hash: currentHead,
    note: matchesCurrentHead
      ? undefined
      : 'signature is valid, but this checkpoint predates the current ledger head — expected between checkpoints, not a forgery signal by itself',
  };
}

module.exports = {
  NoSigningKeyError,
  resolveSigningKey,
  checkpointsDir,
  keysetPath,
  loadKeyset,
  recordPublicKeyInKeyset,
  revokeKey,
  createCheckpoint,
  listCheckpoints,
  latestCheckpoint,
  verifyCheckpoint,
};
