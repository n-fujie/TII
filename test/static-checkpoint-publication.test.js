'use strict';

/**
 * src/export.js buildStaticSite() — publish signed checkpoint evidence into
 * the static site build.
 *
 * REPOSITORY EVIDENCE FOR THIS GAP: SPEC.md §12.3 describes the Ed25519
 * signed checkpoint as the mechanism by which "a ledger head obtained from
 * any source can be checked against" an independent attestation.
 * spec/checkpoint-operation.md states directly: "A checkpoint file can be
 * copied off the server, published independently, mirrored, or diffed by
 * hand." Before this change, buildStaticSite() never read checkpoints/ at
 * all, so the ACTUAL deployed static mirror (the only public deployment —
 * README.md: "Vercel serves a static, read-only mirror") never published
 * any checkpoint file, and its own /audit page rendered
 * `checkpoint_status_MISSING` ("Not available") even when a real, valid,
 * signed checkpoint existed in checkpoints/ — because views.auditPage()
 * shows that string whenever its `checkpoint` argument is falsy
 * (src/views.js's auditPage(), checkpointSection: `if (!checkpoint) return
 * ...MISSING...`), and the static build never passed one.
 *
 * This is read-only with respect to the canonical ledger and to
 * checkpoints themselves: it copies already-created checkpoint files
 * (produced by the separate, already-tested `tii checkpoint create`
 * operator action) into the derived, rebuildable static output — it never
 * creates, signs, or mutates a checkpoint, never touches a private key or
 * passphrase (verifyCheckpoint() only ever needs the PUBLIC key), and
 * copies files by an explicit filename allowlist
 * (`checkpoint-*.json`, `keyset.json`) rather than a directory wildcard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const exporters = require('../src/export');
const checkpointStore = require('../src/checkpoint-store');
const { generateKeypair } = require('../src/checkpoint');
const { Ledger } = require('../src/ledger');
const { withTII } = require('./helpers');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withRealCheckpoint(ledger) {
  const checkpointDir = tmpDir('tii-static-ckpt-');
  const kp = generateKeypair();
  const keyDir = tmpDir('tii-static-ckpt-key-');
  const keyFile = path.join(keyDir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  const created = checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env: { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile } });
  return { checkpointDir, checkpointFile: path.basename(created.file) };
}

/* ============================================== no checkpoint exists yet === */

test('buildStaticSite(): with no checkpoints/ directory at all, the build succeeds, publishes no checkpoints subdirectory, and the audit pages correctly show "not available"', () => {
  const { ledger } = withTII();
  const out = path.join(tmpDir('tii-static-nockpt-'), 'public');
  const nonexistentCheckpointDir = path.join(tmpDir('tii-static-nockpt-empty-'), 'does-not-exist');

  const result = exporters.buildStaticSite(ledger, out, { checkpointDir: nonexistentCheckpointDir });

  assert.equal(result.checkpoint.status, 'MISSING');
  assert.equal(result.checkpoint_files_published, 0);
  assert.equal(fs.existsSync(path.join(out, 'checkpoints')), false, 'no checkpoints/ output directory when there is nothing to publish');

  const enAudit = fs.readFileSync(path.join(out, 'audit.html'), 'utf8');
  const jaAudit = fs.readFileSync(path.join(out, 'ja', 'audit.html'), 'utf8');
  assert.match(enAudit, /Not available/);
  assert.match(jaAudit, /利用不可/);

  const catalog = JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.checkpoint.status, 'MISSING');
});

/* ============================================== a real checkpoint exists === */

test('buildStaticSite(): a real signed checkpoint is published verbatim, and the audit pages + catalog.json correctly report VERIFIED', () => {
  const { ledger } = withTII();
  const { checkpointDir, checkpointFile } = withRealCheckpoint(ledger);
  const out = path.join(tmpDir('tii-static-ckpt-out-'), 'public');

  const result = exporters.buildStaticSite(ledger, out, { checkpointDir });

  assert.equal(result.checkpoint.status, 'VERIFIED');
  assert.equal(result.checkpoint.matches_current_head, true);
  assert.equal(result.checkpoint_files_published, 2, 'the one checkpoint file plus keyset.json');

  const publishedCheckpointPath = path.join(out, 'checkpoints', checkpointFile);
  assert.ok(fs.existsSync(publishedCheckpointPath), 'the checkpoint file must be published under <out>/checkpoints/');
  assert.deepEqual(
    fs.readFileSync(publishedCheckpointPath, 'utf8'),
    fs.readFileSync(path.join(checkpointDir, checkpointFile), 'utf8'),
    'the published checkpoint must be byte-identical to the source — a verbatim copy, not regenerated'
  );

  const publishedKeysetPath = path.join(out, 'checkpoints', 'keyset.json');
  assert.ok(fs.existsSync(publishedKeysetPath), 'keyset.json (public keys only) must also be published');
  assert.deepEqual(
    fs.readFileSync(publishedKeysetPath, 'utf8'),
    fs.readFileSync(path.join(checkpointDir, 'keyset.json'), 'utf8')
  );

  const enAudit = fs.readFileSync(path.join(out, 'audit.html'), 'utf8');
  const jaAudit = fs.readFileSync(path.join(out, 'ja', 'audit.html'), 'utf8');
  assert.match(enAudit, /Verified/);
  assert.match(jaAudit, /検証済み/);
  assert.doesNotMatch(enAudit, /Not available/);

  const catalog = JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.checkpoint.status, 'VERIFIED');
  assert.equal(catalog.checkpoint.matches_current_head, true);
  assert.equal(catalog.checkpoint.key_id, result.checkpoint.key_id);
});

/* ============================================== end-to-end third-party proof === */

test('end-to-end: a published static build can be independently re-verified using ONLY its own published files, as a real third party downloading the site would', () => {
  const { ledger } = withTII();
  const { checkpointDir } = withRealCheckpoint(ledger);
  const out = path.join(tmpDir('tii-static-e2e-'), 'public');
  exporters.buildStaticSite(ledger, out, { checkpointDir });

  // Simulate a third party: load a FRESH Ledger instance from nothing but
  // the published ledger.jsonl (not the original in-memory `ledger` object
  // at all), and verify the published checkpoint against ONLY the
  // published checkpoints/ directory -- exactly spec/checkpoint-operation.md's
  // documented workflow ("verification needs only the checkpoint file, the
  // signer's public key (or the on-disk keyset), and a ledger to check
  // against. It does not require Vercel, the UI, the live Node process, or
  // any network access").
  const downloadedLedger = new Ledger(path.join(out, 'ledger.jsonl')).load();
  const result = checkpointStore.verifyCheckpoint(downloadedLedger, { dir: path.join(out, 'checkpoints') });

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.matches_current_head, true);
  assert.equal(downloadedLedger.verify().ok, true, 'the published ledger.jsonl itself is a valid hash chain');
});

/* ============================================== security: no secret leakage === */

test('buildStaticSite(): never publishes anything resembling a private key or passphrase, even when the checkpoint directory is real', () => {
  const { ledger } = withTII();
  const { checkpointDir } = withRealCheckpoint(ledger);
  const out = path.join(tmpDir('tii-static-secret-scan-'), 'public');
  exporters.buildStaticSite(ledger, out, { checkpointDir });

  const publishedCheckpointsDir = path.join(out, 'checkpoints');
  for (const f of fs.readdirSync(publishedCheckpointsDir)) {
    const content = fs.readFileSync(path.join(publishedCheckpointsDir, f), 'utf8');
    assert.ok(!/BEGIN (EC |RSA |ENCRYPTED )?PRIVATE KEY/.test(content), `${f} must never contain private key material`);
    assert.ok(!/passphrase/i.test(content), `${f} must never mention a passphrase`);
  }
});

/* ============================================== allowlist, not wildcard === */

test('buildStaticSite(): only checkpoint-*.json and keyset.json are ever copied out of the checkpoint directory, never arbitrary files', () => {
  const { ledger } = withTII();
  const { checkpointDir } = withRealCheckpoint(ledger);
  // An unrelated file that must NEVER be published, even though it lives in
  // the same directory -- proves the allowlist is by filename pattern, not
  // "copy everything in this directory".
  fs.writeFileSync(path.join(checkpointDir, 'signing-key.private.pem'), '-----BEGIN PRIVATE KEY-----\nNOT-A-REAL-KEY-JUST-A-CANARY\n-----END PRIVATE KEY-----\n');
  fs.writeFileSync(path.join(checkpointDir, 'notes.txt'), 'operator scratch notes, not for publication');

  const out = path.join(tmpDir('tii-static-allowlist-'), 'public');
  exporters.buildStaticSite(ledger, out, { checkpointDir });

  const published = fs.readdirSync(path.join(out, 'checkpoints'));
  assert.ok(!published.includes('signing-key.private.pem'), 'a private key file must never be published even if present in the checkpoint directory');
  assert.ok(!published.includes('notes.txt'), 'an unrelated file must never be published');
  assert.ok(published.every((f) => (f.startsWith('checkpoint-') && f.endsWith('.json')) || f === 'keyset.json'));
});

/* ============================================== does not mutate the source === */

test('buildStaticSite(): reading and copying checkpoints does not mutate the source checkpoint directory', () => {
  const { ledger } = withTII();
  const { checkpointDir, checkpointFile } = withRealCheckpoint(ledger);
  const before = fs.readFileSync(path.join(checkpointDir, checkpointFile), 'utf8');
  const beforeFiles = fs.readdirSync(checkpointDir).sort();

  const out = path.join(tmpDir('tii-static-nomut-'), 'public');
  exporters.buildStaticSite(ledger, out, { checkpointDir });

  const after = fs.readFileSync(path.join(checkpointDir, checkpointFile), 'utf8');
  const afterFiles = fs.readdirSync(checkpointDir).sort();
  assert.equal(after, before);
  assert.deepEqual(afterFiles, beforeFiles);
});

/* ============================================== real repository checkpoints, read-only === */

test('sanity: the real repository checkpoint directory is never written to by this feature (uses a disposable copy for the actual write path, confirms real checkpoints/ untouched)', () => {
  const REPO_CHECKPOINT_DIR = path.join(__dirname, '..', 'checkpoints');
  const before = fs.existsSync(REPO_CHECKPOINT_DIR) ? fs.readdirSync(REPO_CHECKPOINT_DIR).sort().map((f) => `${f}:${fs.statSync(path.join(REPO_CHECKPOINT_DIR, f)).mtimeMs}`) : [];

  const { ledger } = withTII();
  const { checkpointDir } = withRealCheckpoint(ledger);
  const out = path.join(tmpDir('tii-static-realckpt-'), 'public');
  exporters.buildStaticSite(ledger, out, { checkpointDir }); // disposable checkpointDir, never the real one

  const after = fs.existsSync(REPO_CHECKPOINT_DIR) ? fs.readdirSync(REPO_CHECKPOINT_DIR).sort().map((f) => `${f}:${fs.statSync(path.join(REPO_CHECKPOINT_DIR, f)).mtimeMs}`) : [];
  assert.deepEqual(after, before, 'the real repository checkpoints/ directory must be completely unaffected by any of this test file\'s activity');
});
