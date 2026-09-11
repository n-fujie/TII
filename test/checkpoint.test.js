'use strict';

/**
 * Tests for the CANDIDATE signed-checkpoint design (src/candidate/checkpoint.js).
 * Not wired into the running system.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const cp = require('../src/checkpoint');

function sampleCheckpoint(overrides = {}) {
  return cp.buildCheckpoint({
    ledgerHeadHash: 'eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95',
    eventCount: 10,
    specVersion: '0.1.0',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  });
}

test('sign / verify round-trips', () => {
  const { publicKeyPem, privateKeyPem, keyId } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem, keyId });
  assert.equal(signed.algorithm, 'ed25519');
  assert.equal(cp.verifySignedCheckpoint(signed).ok, true);
});

test('a tampered checkpoint fails verification', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  signed.checkpoint.ledger_head_hash = '0'.repeat(64);
  const r = cp.verifySignedCheckpoint(signed);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-signature');
});

test('a tampered signature fails verification', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  const buf = Buffer.from(signed.signature, 'base64');
  buf[0] ^= 0xff;
  signed.signature = buf.toString('base64');
  assert.equal(cp.verifySignedCheckpoint(signed).ok, false);
});

test('a signature from the wrong key fails verification', () => {
  const a = cp.generateKeypair();
  const b = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), a.privateKeyPem, { publicKeyPem: a.publicKeyPem });
  signed.public_key = b.publicKeyPem;
  signed.key_id = cp.keyId(b.publicKeyPem);
  assert.equal(cp.verifySignedCheckpoint(signed).ok, false);
});

test('canonical JSON: key order in the checkpoint object does not matter', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  // rebuild the checkpoint with keys in a different insertion order
  const c = signed.checkpoint;
  signed.checkpoint = {
    signature_note: undefined,
    spec_version: c.spec_version,
    event_count: c.event_count,
    tii_checkpoint: c.tii_checkpoint,
    created_at: c.created_at,
    ledger_head_hash: c.ledger_head_hash,
  };
  delete signed.checkpoint.signature_note;
  assert.equal(cp.verifySignedCheckpoint(signed).ok, true);
});

test('key rotation: an old checkpoint still verifies against the key valid at its creation time', () => {
  const k1 = cp.generateKeypair();
  const k2 = cp.generateKeypair();
  const keyset = [
    { key_id: k1.keyId, public_key_pem: k1.publicKeyPem, not_before: '2026-01-01T00:00:00.000Z', not_after: '2026-06-30T23:59:59.999Z' },
    { key_id: k2.keyId, public_key_pem: k2.publicKeyPem, not_before: '2026-07-01T00:00:00.000Z' },
  ];

  const early = cp.signCheckpoint(sampleCheckpoint({ createdAt: '2026-03-15T00:00:00.000Z' }), k1.privateKeyPem, { publicKeyPem: k1.publicKeyPem, keyId: k1.keyId });
  const late = cp.signCheckpoint(sampleCheckpoint({ createdAt: '2026-09-15T00:00:00.000Z' }), k2.privateKeyPem, { publicKeyPem: k2.publicKeyPem, keyId: k2.keyId });

  assert.equal(cp.verifySignedCheckpoint(early, { keyset }).ok, true, 'old checkpoint still verifies after rotation');
  assert.equal(cp.verifySignedCheckpoint(late, { keyset }).ok, true);

  // a checkpoint whose creation time is outside the presenting key's window is rejected
  const forged = cp.signCheckpoint(sampleCheckpoint({ createdAt: '2026-09-15T00:00:00.000Z' }), k1.privateKeyPem, { publicKeyPem: k1.publicKeyPem, keyId: k1.keyId });
  const r = cp.verifySignedCheckpoint(forged, { keyset });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'checkpoint-after-key-validity');
});

test('compromised-key declaration: checkpoints after revocation are rejected', () => {
  const k = cp.generateKeypair();
  const keyset = [
    { key_id: k.keyId, public_key_pem: k.publicKeyPem, not_before: '2026-01-01T00:00:00.000Z', revoked_at: '2026-05-01T00:00:00.000Z' },
  ];
  const before = cp.signCheckpoint(sampleCheckpoint({ createdAt: '2026-04-01T00:00:00.000Z' }), k.privateKeyPem, { publicKeyPem: k.publicKeyPem, keyId: k.keyId });
  const after = cp.signCheckpoint(sampleCheckpoint({ createdAt: '2026-06-01T00:00:00.000Z' }), k.privateKeyPem, { publicKeyPem: k.publicKeyPem, keyId: k.keyId });
  assert.equal(cp.verifySignedCheckpoint(before, { keyset }).ok, true, 'pre-compromise checkpoints stay valid');
  assert.equal(cp.verifySignedCheckpoint(after, { keyset }).reason, 'key-revoked-before-checkpoint');
});

test('portability: a signed checkpoint verifies from a plain file alone', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ckpt-'));
  const file = path.join(dir, 'checkpoint-000010.json');
  fs.writeFileSync(file, cp.serialize(signed));

  // fresh process state: only the file
  const loaded = cp.deserialize(fs.readFileSync(file, 'utf8'));
  assert.equal(cp.verifySignedCheckpoint(loaded).ok, true);
  assert.equal(loaded.checkpoint.event_count, 10);
});

test('corrupted checkpoint file is rejected, not silently accepted', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  const text = cp.serialize(signed).replace('"event_count": 10', '"event_count": 11');
  assert.equal(cp.verifySignedCheckpoint(cp.deserialize(text)).ok, false);
});

test('checkpoint binds the required fields', () => {
  const c = sampleCheckpoint();
  for (const k of ['tii_checkpoint', 'ledger_head_hash', 'event_count', 'created_at', 'spec_version']) {
    assert.ok(k in c, `checkpoint must bind ${k}`);
  }
});

test('RFC 8785 JCS: the signing input is property-order and whitespace independent', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  assert.equal(signed.canonicalization, 'RFC8785-JCS');

  // reorder every property of the checkpoint before verifying
  const c = signed.checkpoint;
  const reordered = {
    spec_version: c.spec_version,
    created_at: c.created_at,
    tii_checkpoint: c.tii_checkpoint,
    event_count: c.event_count,
    ledger_head_hash: c.ledger_head_hash,
  };
  assert.equal(cp.verifySignedCheckpoint({ ...signed, checkpoint: reordered }).ok, true);

  // pretty-print the whole file, then re-import and verify
  const fileText = JSON.stringify(signed, null, 4).replace(/\n/g, '\r\n') + '\n\n';
  assert.equal(cp.verifySignedCheckpoint(cp.deserialize(fileText)).ok, true);
});

test('RFC 8785 JCS: Unicode and numeric-edge checkpoint fields verify across a round trip', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const ck = cp.buildCheckpoint({
    ledgerHeadHash: 'a'.repeat(64),
    eventCount: Number.MAX_SAFE_INTEGER,
    specVersion: '1.0.0',
    createdAt: '2026-06-01T00:00:00.000Z',
    extra: { note: '遷移発火 — checkpoint', ratio: 0.1, big: 1e30 },
  });
  const signed = cp.signCheckpoint(ck, privateKeyPem, { publicKeyPem });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ckpt-u-'));
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, cp.serialize(signed));
  const back = cp.deserialize(fs.readFileSync(file, 'utf8'));
  assert.equal(cp.verifySignedCheckpoint(back).ok, true);
  assert.equal(back.checkpoint.extra.note, '遷移発火 — checkpoint');
  assert.equal(back.checkpoint.event_count, Number.MAX_SAFE_INTEGER);
});

test('a re-imported checkpoint file with a duplicate property is rejected before verification', () => {
  const { publicKeyPem, privateKeyPem } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem });
  const text = cp.serialize(signed).replace(
    '"event_count": 10,',
    '"event_count": 10,\n    "event_count": 99,'
  );
  assert.throws(() => cp.deserialize(text), (e) => e.code === 'duplicate-key');
});

test('export / reconstruct: verification depends on nothing but the files', () => {
  const { publicKeyPem, privateKeyPem, keyId } = cp.generateKeypair();
  const signed = cp.signCheckpoint(sampleCheckpoint(), privateKeyPem, { publicKeyPem, keyId });
  const keyset = [{ key_id: keyId, public_key_pem: publicKeyPem, not_before: '2026-01-01T00:00:00.000Z' }];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-kit-'));
  fs.writeFileSync(path.join(dir, 'checkpoint-000010.json'), cp.serialize(signed));
  fs.writeFileSync(path.join(dir, 'keyset.json'), JSON.stringify(keyset, null, 2) + '\n');

  // "another implementation": only the two files, nothing else
  const loadedCk = cp.deserialize(fs.readFileSync(path.join(dir, 'checkpoint-000010.json'), 'utf8'));
  const loadedKs = JSON.parse(fs.readFileSync(path.join(dir, 'keyset.json'), 'utf8'));
  assert.equal(cp.verifySignedCheckpoint(loadedCk, { keyset: loadedKs }).ok, true);
});
