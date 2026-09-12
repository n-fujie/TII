'use strict';

/**
 * §5-§11, §37.A-E of production-hardening Phase 1 — the LIVE checkpoint
 * operational layer (src/checkpoint-store.js): key resolution (fail-closed),
 * create/list/verify, key rotation, and the permanent full-chain-forgery
 * regression test (§11 — "this test must remain permanently in the suite").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const { canonicalize } = require('../src/canonical');
const { sha256 } = require('../src/hash');
const store = require('../src/checkpoint-store');
const { generateKeypair } = require('../src/checkpoint');

function freshLedger(n = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ckptstore-'));
  const l = new Ledger(path.join(dir, 'ledger.jsonl')).load();
  const { tii } = l.issueTII({ recorder: { id: 't', kind: 'person' } });
  for (let i = 0; i < n; i++) l.append({ tii, event_type: 'note.added', recorder: { id: 't', kind: 'person' }, content: { module: 'note', ref: 'n' + i, text: 'event ' + i } });
  return { l, tii, dir };
}

function withKeyEnv(kp, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-key-'));
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  return fn({ TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile });
}

/* --------------------------------------------------------- D: fail-closed --- */

test('D — checkpoint creation FAILS CLOSED with no signing key configured (never fabricates an unsigned checkpoint, never auto-generates a key)', () => {
  const { l, dir } = freshLedger();
  assert.equal(store.resolveSigningKey({}), null);
  assert.throws(
    () => store.createCheckpoint(l, { dir: path.join(dir, 'checkpoints'), env: {} }),
    (e) => e instanceof store.NoSigningKeyError && e.code === 'no-signing-key'
  );
  assert.equal(store.listCheckpoints(path.join(dir, 'checkpoints')).length, 0, 'no checkpoint file was written');
});

test('reads continue with no signing key: verifyCheckpoint reports MISSING, not an error, when nothing exists', () => {
  const { l, dir } = freshLedger();
  const result = store.verifyCheckpoint(l, { dir: path.join(dir, 'checkpoints') });
  assert.equal(result.status, 'MISSING');
});

/* -------------------------------------------------------- A/B: generate/verify --- */

test('A/B — create then verify a checkpoint against the live ledger', () => {
  const { l, dir } = freshLedger();
  const kp = generateKeypair();
  withKeyEnv(kp, (env) => {
    const ckptDir = path.join(dir, 'checkpoints');
    const created = store.createCheckpoint(l, { dir: ckptDir, env });
    assert.equal(created.ledger_chain_valid, true);
    assert.ok(fs.existsSync(created.file));

    const verified = store.verifyCheckpoint(l, { dir: ckptDir });
    assert.equal(verified.status, 'VERIFIED');
    assert.equal(verified.matches_current_head, true);
    assert.equal(verified.checkpoint.ledger_head_hash, l.verify().head_hash);
    assert.equal(verified.key_id, kp.keyId);
  });
});

test('a stale-but-validly-signed checkpoint is VERIFIED with matches_current_head:false, not treated as a forgery signal', () => {
  const { l, dir } = freshLedger();
  const kp = generateKeypair();
  withKeyEnv(kp, (env) => {
    const ckptDir = path.join(dir, 'checkpoints');
    store.createCheckpoint(l, { dir: ckptDir, env });
    l.append({ tii: l.listTIIs()[0], event_type: 'note.added', recorder: { id: 't', kind: 'person' }, content: {} }); // new event since the checkpoint
    const verified = store.verifyCheckpoint(l, { dir: ckptDir });
    assert.equal(verified.status, 'VERIFIED');
    assert.equal(verified.matches_current_head, false);
  });
});

/* -------------------------------------------------- C: THE PERMANENT REGRESSION --- */

test('C — PERMANENT REGRESSION: a fully-recomputed forged chain passes Ledger.verify() but FAILS checkpoint verification', () => {
  const { l, dir, tii } = freshLedger(6);
  const kp = generateKeypair();

  const legitCheckpoint = withKeyEnv(kp, (env) => {
    const ckptDir = path.join(dir, 'checkpoints');
    return { ckptDir, result: store.createCheckpoint(l, { dir: ckptDir, env }) };
  });

  // ---- forge: rewrite an OLD historical event and recompute every downstream hash ----
  const events = JSON.parse('[' + fs.readFileSync(l.file, 'utf8').trim().split('\n').join(',') + ']');
  events[2].content = { module: 'note', ref: 'n1', text: 'FORGED — rewritten by an attacker with file access' };
  events[2].recorder = { id: 'attacker', kind: 'person' };
  let prev = events[1].hash;
  for (let i = 2; i < events.length; i++) {
    events[i].prev_hash = prev;
    const { hash, ...body } = events[i];
    events[i].hash = sha256(events[i].prev_hash + canonicalize(body));
    prev = events[i].hash;
  }
  const forgedFile = path.join(dir, 'forged.jsonl');
  fs.writeFileSync(forgedFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const forgedLedger = new Ledger(forgedFile).load();

  // 1. INTERNAL CHAIN INTEGRITY — the forgery IS internally self-consistent.
  const chainResult = forgedLedger.verify();
  assert.equal(chainResult.ok, true, 'the forged chain is internally consistent — Ledger.verify() alone cannot see the forgery');

  // 2. SIGNED CHECKPOINT — verifying the forged ledger against the ORIGINAL
  //    checkpoint must fail, because the forged head differs from the
  //    attested head. This is claim (B) catching what claim (A) cannot.
  const checkResult = store.verifyCheckpoint(forgedLedger, { dir: legitCheckpoint.ckptDir });
  assert.equal(checkResult.status, 'VERIFIED', 'the checkpoint FILE itself is still validly signed...');
  assert.equal(checkResult.matches_current_head, false, '...but it does NOT match the forged ledger\'s (different) head — the forgery is exposed');
  assert.notEqual(checkResult.checkpoint.ledger_head_hash, forgedLedger.verify().head_hash);
  assert.equal(checkResult.checkpoint.ledger_head_hash, l.verify().head_hash, 'the checkpoint still attests to the REAL, original head');
});

/* --------------------------------------------------------- E: key rotation --- */

test('E — a historical checkpoint verifies against the key that was valid at its creation time, after rotation', () => {
  const { l, dir } = freshLedger(2);
  const k1 = generateKeypair();
  const k2 = generateKeypair();
  const ckptDir = path.join(dir, 'checkpoints');

  const early = withKeyEnv(k1, (env) => store.createCheckpoint(l, { dir: ckptDir, env, createdAt: '2026-01-01T00:00:00.000Z' }));
  store.revokeKey(ckptDir, k1.keyId, '2026-06-01T00:00:00.000Z');
  l.append({ tii: l.listTIIs()[0], event_type: 'note.added', recorder: { id: 't', kind: 'person' }, content: {} });
  withKeyEnv(k2, (env) => store.createCheckpoint(l, { dir: ckptDir, env, createdAt: '2026-07-01T00:00:00.000Z' }));

  const keyset = store.loadKeyset(ckptDir);
  assert.equal(keyset.length, 2);
  assert.ok(keyset.find((k) => k.key_id === k1.keyId).revoked_at);

  // verify the EARLY (pre-revocation) checkpoint explicitly — still valid at its own time
  const earlyResult = store.verifyCheckpoint(l, { dir: ckptDir, file: early.file, keyset });
  assert.equal(earlyResult.status, 'VERIFIED', 'a checkpoint made before revocation stays verifiable');

  // the LATEST checkpoint (k2) verifies too
  const latestResult = store.verifyCheckpoint(l, { dir: ckptDir, keyset });
  assert.equal(latestResult.status, 'VERIFIED');
  assert.equal(latestResult.key_id, k2.keyId);
});

test('list orders checkpoints and reports event_count / created_at / key_id', () => {
  const { l, dir } = freshLedger(1);
  const kp = generateKeypair();
  const ckptDir = path.join(dir, 'checkpoints');
  withKeyEnv(kp, (env) => {
    store.createCheckpoint(l, { dir: ckptDir, env });
    l.append({ tii: l.listTIIs()[0], event_type: 'note.added', recorder: { id: 't', kind: 'person' }, content: {} });
    store.createCheckpoint(l, { dir: ckptDir, env });
  });
  const list = store.listCheckpoints(ckptDir);
  assert.equal(list.length, 2);
  assert.ok(list[0].event_count <= list[1].event_count);
  assert.ok(list.every((c) => c.key_id === kp.keyId));
});

/* ============================================================================
 * G3 custody correction (spec/production-key-custody.md §8.5): the production
 * operational key must be a passphrase-encrypted PKCS8 PEM, not a generally-
 * readable plaintext file. These tests prove resolveSigningKey() correctly
 * loads an encrypted key with the right passphrase, fails closed with no
 * passphrase, fails closed with the wrong passphrase, never persists a
 * decrypted copy to disk, and that checkpoints signed this way verify exactly
 * like ones signed from a plain (test/disposable) key.
 * ==========================================================================*/

function encryptedKeyFile(kp, passphrase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-enckey-'));
  const keyObject = require('node:crypto').createPrivateKey(kp.privateKeyPem);
  const encryptedPem = keyObject.export({
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: Buffer.from(passphrase, 'utf8'),
  });
  const keyFile = path.join(dir, 'key.encrypted.pem');
  fs.writeFileSync(keyFile, encryptedPem, { mode: 0o600 });
  assert.match(fs.readFileSync(keyFile, 'utf8'), /BEGIN ENCRYPTED PRIVATE KEY/, 'sanity: the staged file really is passphrase-encrypted');
  return keyFile;
}

test('G3 custody: an encrypted key with the CORRECT passphrase loads and signs successfully', () => {
  const { l, dir } = freshLedger(1);
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'correct horse battery staple');
  const env = { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile, TII_CHECKPOINT_KEY_PASSPHRASE: 'correct horse battery staple' };

  const resolved = store.resolveSigningKey(env);
  assert.ok(resolved, 'the key must resolve when the correct passphrase is supplied');
  assert.equal(resolved.keyId, kp.keyId);

  const ckptDir = path.join(dir, 'checkpoints');
  const created = store.createCheckpoint(l, { dir: ckptDir, env });
  assert.ok(fs.existsSync(created.file));
  const verified = store.verifyCheckpoint(l, { dir: ckptDir });
  assert.equal(verified.status, 'VERIFIED', 'a checkpoint signed via an encrypted key verifies exactly like one signed via a plain key');
  assert.equal(verified.key_id, kp.keyId);
});

test('G3 custody: an encrypted key with NO passphrase configured fails closed (never attempted)', () => {
  const { l, dir } = freshLedger(1);
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'some passphrase');
  const env = { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile }; // no TII_CHECKPOINT_KEY_PASSPHRASE(_FILE) at all

  assert.equal(store.resolveSigningKey(env), null, 'resolveSigningKey must return null, never throw, never guess');
  assert.throws(
    () => store.createCheckpoint(l, { dir: path.join(dir, 'checkpoints'), env }),
    (e) => e instanceof store.NoSigningKeyError && e.code === 'no-signing-key'
  );
});

test('G3 custody: an encrypted key with the WRONG passphrase fails closed (not a crash, not silently accepted)', () => {
  const { l, dir } = freshLedger(1);
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'the real passphrase');
  const env = { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile, TII_CHECKPOINT_KEY_PASSPHRASE: 'a guessed wrong passphrase' };

  assert.equal(store.resolveSigningKey(env), null, 'a wrong passphrase must resolve to null, not throw an uncaught crypto error');
  assert.throws(
    () => store.createCheckpoint(l, { dir: path.join(dir, 'checkpoints'), env }),
    (e) => e instanceof store.NoSigningKeyError
  );
});

test('G3 custody: the passphrase may also be supplied via TII_CHECKPOINT_KEY_PASSPHRASE_FILE', () => {
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'file-supplied passphrase');
  const passphraseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-pass-'));
  const passphraseFile = path.join(passphraseDir, 'passphrase.txt');
  fs.writeFileSync(passphraseFile, 'file-supplied passphrase\n', { mode: 0o600 });

  const resolved = store.resolveSigningKey({ TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile, TII_CHECKPOINT_KEY_PASSPHRASE_FILE: passphraseFile });
  assert.ok(resolved);
  assert.equal(resolved.keyId, kp.keyId);
});

test('G3 custody: an ordinary UNENCRYPTED key still loads exactly as before (no regression for test/disposable keys)', () => {
  const kp = generateKeypair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-plainkey-'));
  const keyFile = path.join(dir, 'plain-key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem);
  const resolved = store.resolveSigningKey({ TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile });
  assert.ok(resolved);
  assert.equal(resolved.keyId, kp.keyId);
});

test('G3 custody: resolveSigningKey() never persists a decrypted plaintext copy to disk', () => {
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'no persistence please');
  const dirBefore = fs.readdirSync(path.dirname(keyFile));
  store.resolveSigningKey({ TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile, TII_CHECKPOINT_KEY_PASSPHRASE: 'no persistence please' });
  const dirAfter = fs.readdirSync(path.dirname(keyFile));
  assert.deepEqual(dirAfter, dirBefore, 'no new file must appear as a side effect of resolving/decrypting the key');
  // and the source file on disk must still be the encrypted form, untouched
  assert.match(fs.readFileSync(keyFile, 'utf8'), /BEGIN ENCRYPTED PRIVATE KEY/);
});

test('G3 custody: production issuance remains disabled regardless of encrypted-key availability', () => {
  const gate = require('../src/production-gate');
  const kp = generateKeypair();
  const keyFile = encryptedKeyFile(kp, 'irrelevant to production gate');
  const status = gate.computeGateStatus({
    ledgerFile: path.join(__dirname, '..', 'data', 'ledger.jsonl'),
    env: { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile, TII_CHECKPOINT_KEY_PASSPHRASE: 'irrelevant to production gate' },
  });
  assert.equal(status.available, false, 'having a usable signing key is necessary but never sufficient for the production gate');
});
