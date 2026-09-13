#!/usr/bin/env node
'use strict';
/**
 * G3 final production key ceremony -- compatibility test.
 *
 * Run this yourself, in your own terminal. It never prints private-key or
 * passphrase material. It reads the encrypted key via the exact same
 * TII_CHECKPOINT_PRIVATE_KEY_FILE / TII_CHECKPOINT_KEY_PASSPHRASE_FILE
 * mechanism already implemented in src/checkpoint-store.js -- nothing new.
 *
 * It operates ONLY on a disposable temp ledger (created and destroyed inside
 * this script, in your OS temp dir) -- the real data/ledger.jsonl is never
 * opened, read, or written.
 *
 * Usage (from the tii/ repo root):
 *   export TII_CHECKPOINT_PRIVATE_KEY_FILE=~/.tii-production/signing-key.encrypted.pem
 *   export TII_CHECKPOINT_KEY_PASSPHRASE_FILE=/path/to/a/temp/passphrase/file/you/create
 *   node scripts/g3-production-key-test.js
 *
 * Afterwards, delete the temp passphrase file yourself:
 *   rm -f /path/to/a/temp/passphrase/file/you/create
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../src/checkpoint-store.js');
const { Ledger } = require('../src/ledger.js');

function result(fields) {
  console.log(JSON.stringify(fields, null, 2));
}

const key = store.resolveSigningKey(process.env);
if (!key) {
  result({
    ok: false,
    step: 'resolveSigningKey',
    reason: 'no-signing-key',
    detail:
      'Key did not load. Check TII_CHECKPOINT_PRIVATE_KEY_FILE points at the ' +
      'encrypted PEM and TII_CHECKPOINT_KEY_PASSPHRASE_FILE points at a file ' +
      'containing exactly the correct passphrase (optionally one trailing newline).',
  });
  process.exit(1);
}

const keyId = key.keyId;

// Disposable temp ledger -- never the real data/ledger.jsonl.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-g3-prodkey-test-'));
const ledgerFile = path.join(tmpDir, 'disposable-ledger.jsonl');
const checkpointDir = path.join(tmpDir, 'checkpoints');

const l = new Ledger(ledgerFile).load();
const { tii } = l.issueTII({ recorder: { id: 'g3-test', kind: 'person' } });
for (let i = 0; i < 3; i++) {
  l.append({
    tii,
    event_type: 'note.added',
    recorder: { id: 'g3-test', kind: 'person' },
    content: { module: 'note', ref: 'disposable-' + i, text: 'G3 compatibility test event ' + i },
  });
}

let signOk = false, verifyOk = false, tamperRejectCount = 0;
let checkpointPath = null;
let signErr = null, verifyErr = null;

try {
  const cp = store.createCheckpoint(l, { dir: checkpointDir, env: process.env });
  checkpointPath = cp.file;
  signOk = true;
} catch (e) {
  signErr = e.message;
}

if (signOk) {
  try {
    const v = store.verifyCheckpoint(l, { dir: checkpointDir });
    verifyOk = v.status === 'VERIFIED';
    if (!verifyOk) verifyErr = JSON.stringify(v);
  } catch (e) {
    verifyErr = e.message;
  }

  // Tamper tests: mutate the checkpoint file 4 ways, confirm verify fails each time.
  const original = fs.readFileSync(checkpointPath, 'utf8');
  const tamperVariants = [
    (s) => s.replace(/"ledger_head_hash":\s*"[a-f0-9]+"/, '"ledger_head_hash": "' + '0'.repeat(64) + '"'),
    (s) => s.replace(/"signature":\s*"[A-Za-z0-9+/=]+"/, (m) => m.slice(0, -5) + 'XXXX"'),
    (s) => s.replace(/"event_count":\s*(\d+)/, (m, n) => `"event_count": ${parseInt(n, 10) + 1}`),
    (s) => s.replace(/"key_id":\s*"[a-f0-9]+"/, '"key_id": "' + '0'.repeat(16) + '"'),
  ];
  for (const mutate of tamperVariants) {
    try {
      fs.writeFileSync(checkpointPath, mutate(original));
      const v = store.verifyCheckpoint(l, { dir: checkpointDir });
      if (v.status !== 'VERIFIED') tamperRejectCount += 1;
    } catch {
      tamperRejectCount += 1; // a thrown error on tampered input also counts as correctly rejected
    } finally {
      fs.writeFileSync(checkpointPath, original);
    }
  }
}

// Cleanup disposable ledger/checkpoint artifacts.
fs.rmSync(tmpDir, { recursive: true, force: true });

result({
  ok: signOk && verifyOk && tamperRejectCount === 4,
  production_key_id: keyId,
  key_id_matches_retired_ceremony_key: keyId === '1b96b82d535afc95',
  sign_test: signOk ? 'PASS' : `FAIL: ${signErr}`,
  verify_test: verifyOk ? 'PASS' : `FAIL: ${verifyErr}`,
  tamper_tests: `${tamperRejectCount}/4 correctly rejected`,
  note: 'This test used a disposable temp ledger only. The real data/ledger.jsonl was never opened.',
});
