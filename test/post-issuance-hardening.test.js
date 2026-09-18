'use strict';

/**
 * scripts/verify-first-production-issuance.js and
 * scripts/preflight-production-issuance.js — the two read-only hardening
 * tools added after the first production issuance
 * (spec/verification/first-production-issuance-2026-09-17.{json,md}).
 *
 * Every test here either (a) runs a script for real against the actual
 * repository and proves it did not mutate anything, or (b) runs a
 * deliberately-tampered DISPOSABLE COPY of a script (written into scripts/
 * so its __dirname-relative requires still resolve, then deleted in a
 * finally block) to prove the fail-closed path actually fires. No test in
 * this file ever modifies data/ledger.jsonl, checkpoints/, or any git ref.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const VERIFY_SCRIPT = path.join(REPO, 'scripts', 'verify-first-production-issuance.js');
const PREFLIGHT_SCRIPT = path.join(REPO, 'scripts', 'preflight-production-issuance.js');
const LEDGER_FILE = path.join(REPO, 'data', 'ledger.jsonl');
const CHECKPOINT_DIR = path.join(REPO, 'checkpoints');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function checkpointInventory() {
  return fs.existsSync(CHECKPOINT_DIR)
    ? fs.readdirSync(CHECKPOINT_DIR).sort().map((f) => `${f}:${sha256(path.join(CHECKPOINT_DIR, f))}`)
    : [];
}
function runNode(scriptPath, args = [], opts = {}) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd: REPO, encoding: 'utf8', ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || '' };
  }
}
/** Write a tampered, disposable copy of a script INSIDE scripts/ (so its
 * __dirname-relative `path.join(__dirname, '..')` still resolves to this
 * real repo), run it, then always delete the copy. */
function withTamperedCopy(originalPath, transform, fn) {
  const dir = path.dirname(originalPath);
  const disposableName = `.disposable-test-${crypto.randomBytes(6).toString('hex')}.js`;
  const disposablePath = path.join(dir, disposableName);
  try {
    const src = fs.readFileSync(originalPath, 'utf8');
    fs.writeFileSync(disposablePath, transform(src));
    return fn(disposablePath);
  } finally {
    fs.rmSync(disposablePath, { force: true });
  }
}

/* ============================================================ non-mutation === */

test('non-mutation: running verify-first-production-issuance.js changes nothing on disk', () => {
  const before = { ledger: sha256(LEDGER_FILE), checkpoints: checkpointInventory(), tags: execFileSync('git', ['tag', '--list'], { cwd: REPO, encoding: 'utf8' }) };
  runNode(VERIFY_SCRIPT);
  const after = { ledger: sha256(LEDGER_FILE), checkpoints: checkpointInventory(), tags: execFileSync('git', ['tag', '--list'], { cwd: REPO, encoding: 'utf8' }) };
  assert.deepEqual(after, before, 'the verification script must not change the ledger, checkpoints, or git tags');
});

/* ================================================== verify script: success === */

test('verify-first-production-issuance.js: succeeds against the real, untampered repository', () => {
  const { code, out } = runNode(VERIFY_SCRIPT);
  const result = JSON.parse(out);
  assert.equal(code, 0);
  assert.equal(result.ok, true);
  assert.ok(result.checks.every((c) => c.ok === true), JSON.stringify(result.checks.filter((c) => !c.ok)));
});

/* ================================================ verify script: fail-closed === */

test('verify-first-production-issuance.js: wrong expected tag-resolved commit -> fails closed', () => {
  withTamperedCopy(VERIFY_SCRIPT, (src) => {
    assert.ok(src.includes("tagResolvedCommit: '2306df1c0741e0d7046bbc45957d21dad50a082d'"));
    return src.replace("tagResolvedCommit: '2306df1c0741e0d7046bbc45957d21dad50a082d'", `tagResolvedCommit: '${'0'.repeat(40)}'`);
  }, (copy) => {
    const { code, out } = runNode(copy);
    const result = JSON.parse(out);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    const tagCheck = result.checks.find((c) => c.name === 'tag resolves to the expected immutable commit');
    assert.equal(tagCheck.ok, false);
  });
});

test('verify-first-production-issuance.js: wrong expected first-production event hash -> fails closed', () => {
  withTamperedCopy(VERIFY_SCRIPT, (src) => {
    assert.ok(src.includes("hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc',\n    identifier_status: 'production',"));
    return src.replace(
      "hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc',\n    identifier_status: 'production',",
      "hash: '0'.repeat(64),\n    identifier_status: 'production',"
    );
  }, (copy) => {
    const { code, out } = runNode(copy);
    const result = JSON.parse(out);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    const fieldCheck = result.checks.find((c) => c.name === 'first production issuance event fields unchanged');
    assert.equal(fieldCheck.ok, false);
  });
});

test('verify-first-production-issuance.js: wrong expected checkpoint key_id -> fails closed', () => {
  withTamperedCopy(VERIFY_SCRIPT, (src) => {
    assert.ok(src.includes("checkpointKeyId: '1486de6152baec7f',"));
    return src.replace("checkpointKeyId: '1486de6152baec7f',", "checkpointKeyId: 'deadbeefdeadbeef',");
  }, (copy) => {
    const { code, out } = runNode(copy);
    const result = JSON.parse(out);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((c) => c.name.startsWith('known checkpoint verifies:') && c.ok === false));
  });
});

test('verify-first-production-issuance.js: unknown event_id (simulating the event having moved/disappeared) -> fails closed', () => {
  withTamperedCopy(VERIFY_SCRIPT, (src) => {
    assert.ok(src.includes("event_id: 'evt_bfrbdmdd6sprept3',"));
    return src.replace("event_id: 'evt_bfrbdmdd6sprept3',", "event_id: 'evt_does_not_exist_at_all',");
  }, (copy) => {
    const { code, out } = runNode(copy);
    const result = JSON.parse(out);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    const existsCheck = result.checks.find((c) => c.name === 'the first production issuance event still exists, unmoved');
    assert.equal(existsCheck.ok, false);
  });
});

test('verify-first-production-issuance.js: verification record mismatch -> fails closed', () => {
  // Tamper the RECORD (not the script) in place, restoring it in `finally`
  // regardless of assertion outcome.
  const recordPath = path.join(REPO, 'spec', 'verification', 'first-production-issuance-2026-09-17.json');
  const originalRecord = fs.readFileSync(recordPath, 'utf8');
  try {
    const tampered = JSON.parse(originalRecord);
    tampered.annotated_tag.resolved_commit_sha = '0'.repeat(40);
    fs.writeFileSync(recordPath, JSON.stringify(tampered, null, 2));
    const { code, out } = runNode(VERIFY_SCRIPT);
    const result = JSON.parse(out);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    const recordCheck = result.checks.find((c) => c.name === 'verification record: tag resolved commit matches independent observation');
    assert.equal(recordCheck.ok, false);
  } finally {
    fs.writeFileSync(recordPath, originalRecord);
  }
});

test('verify-first-production-issuance.js: structurally incapable of issuing — never imports src/production-issuance.js or src/production-gate.js', () => {
  const src = fs.readFileSync(VERIFY_SCRIPT, 'utf8');
  assert.ok(!/require\(.*production-issuance/.test(src));
  assert.ok(!/require\(.*production-gate/.test(src));
});

/* ================================================ preflight script: shape ===
 * NOTE ON INVOCATION COUNT: preflight-production-issuance.js's own "complete
 * test suite passes" check shells out to a full `npm test` run by default.
 * An earlier version of this file included one automated test that invoked
 * the real CLI path end to end (paying that nested-full-suite cost once).
 * That was removed: it was observed to intermittently starve an unrelated,
 * genuinely timing-sensitive PRE-EXISTING concurrency test
 * (test/production-gate.test.js's "G6 repair — CONCURRENCY" test) under
 * elevated process load, causing an occasional unrelated failure that had
 * nothing to do with the preflight script's own correctness. That
 * pre-existing latent flakiness is a separate finding, not something this
 * narrowly-scoped hardening task fixes (it would mean touching
 * src/production-issuance.js's concurrency handling, out of scope here).
 * The real CLI entry point (argv parsing -> exit code -> JSON on stdout,
 * with the real unstubbed test-suite check) was manually verified multiple
 * times during this work instead; see this task's final report. Every test
 * below calls the exported runPreflight() IN-PROCESS with a stub
 * `runTestSuite`, exercising the exact same check logic deterministically
 * and without the nested full-suite cost. That stub is reachable only via
 * a direct require() from this test file -- see the TESTABILITY NOTE in
 * scripts/preflight-production-issuance.js for why this is not a bypass:
 * the CLI entry point (the only way this script is ever really invoked for
 * an actual preflight) always uses the real default, with no flag or
 * environment variable able to reach the override.
 */
const { runPreflight } = require(PREFLIGHT_SCRIPT);
const fakePassingTestSuite = () => ({ total: 1, pass: 1, fail: 0 });

test('runPreflight(): stable checks (ledger integrity, checkpoint integrity, uniqueness, gate-not-persisted) pass against the real repository, with a stubbed test-suite step', () => {
  const before = { ledger: sha256(LEDGER_FILE), checkpoints: checkpointInventory() };
  const result = runPreflight({ runTestSuite: fakePassingTestSuite });
  const after = { ledger: sha256(LEDGER_FILE), checkpoints: checkpointInventory() };
  assert.deepEqual(after, before, 'runPreflight() must not mutate the ledger or checkpoints');

  assert.equal(typeof result.preflight_passed, 'boolean');
  assert.equal(result.disclaimer, 'PREFLIGHT PASSED does not mean ISSUANCE AUTHORIZED. A successful preflight establishes only that the repository is in a state suitable for human review. It does not authorize or execute production issuance.');
  assert.ok(Array.isArray(result.checks) && result.checks.length > 0);
  assert.ok(!/BEGIN (EC |RSA |ENCRYPTED )?PRIVATE KEY/.test(JSON.stringify(result)), 'output must never contain PEM key material');

  const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
  assert.equal(byName['ledger chain integrity'].ok, true);
  assert.equal(byName['ledger recovery not required'].ok, true);
  assert.equal(byName['every existing checkpoint file verifies against its public key'].ok, true);
  assert.equal(byName['no duplicate TII identifiers in the ledger'].ok, true);
  assert.equal(byName['no idempotency key is associated with more than one distinct TII'].ok, true);
  assert.equal(byName['production gate is NOT already satisfied in this ambient shell (no accidental persistence)'].ok, true);
  assert.equal(byName['first-production-issuance evidence still independently verifies (delegates to verify-first-production-issuance.js, not reimplemented)'].ok, true);

  const configCheck = byName['configuration presence report (booleans/paths only, no values)'];
  assert.ok(configCheck);
  for (const v of Object.values(configCheck.detail)) {
    assert.notEqual(typeof v, 'string', 'configuration presence report must contain only booleans/null, never a raw secret value as unexpected string content');
  }
});

test('runPreflight(): a failing stubbed test-suite result fails the "complete test suite passes" check', () => {
  const result = runPreflight({ runTestSuite: () => ({ total: 257, pass: 256, fail: 1 }) });
  assert.equal(result.preflight_passed, false);
  const testSuiteCheck = result.checks.find((c) => c.name === 'complete test suite passes');
  assert.equal(testSuiteCheck.ok, false);
});

test('runPreflight(): detects a dirty working tree and fails closed', () => {
  const scratchFile = path.join(REPO, '.preflight-test-scratch-file.tmp');
  fs.writeFileSync(scratchFile, 'scratch');
  try {
    const result = runPreflight({ runTestSuite: fakePassingTestSuite });
    assert.equal(result.preflight_passed, false);
    const treeCheck = result.checks.find((c) => c.name === 'working tree is clean');
    assert.equal(treeCheck.ok, false);
    assert.ok(treeCheck.detail.dirty_entries.some((l) => l.includes('.preflight-test-scratch-file.tmp')));
  } finally {
    fs.rmSync(scratchFile, { force: true });
  }
});

test('runPreflight(): --idempotency-key for the ALREADY-USED first-production key reports already_used, and fails that check', () => {
  const result = runPreflight({ runTestSuite: fakePassingTestSuite, candidateIdempotencyKey: 'tii-first-production-issuance-2026-09-17' });
  const keyCheck = result.checks.find((c) => c.name.includes('tii-first-production-issuance-2026-09-17'));
  assert.ok(keyCheck, 'expected an idempotency-key uniqueness check for the supplied key');
  assert.equal(keyCheck.ok, false);
  assert.equal(keyCheck.detail.already_used, true);
});

test('runPreflight(): --idempotency-key for a genuinely unused key reports not already_used', () => {
  const freshKey = `preflight-test-unused-key-${crypto.randomBytes(4).toString('hex')}`;
  const result = runPreflight({ runTestSuite: fakePassingTestSuite, candidateIdempotencyKey: freshKey });
  const keyCheck = result.checks.find((c) => c.name.includes(freshKey));
  assert.ok(keyCheck);
  assert.equal(keyCheck.ok, true);
  assert.equal(keyCheck.detail.already_used, false);
});

test('preflight-production-issuance.js: structurally incapable of issuing — never imports src/production-issuance.js', () => {
  const src = fs.readFileSync(PREFLIGHT_SCRIPT, 'utf8');
  assert.ok(!/require\(.*production-issuance/.test(src), 'the preflight must never be able to invoke the real issuance path');
});

test('preflight-production-issuance.js: never sets, exports, or persists any TII_* environment variable itself', () => {
  const src = fs.readFileSync(PREFLIGHT_SCRIPT, 'utf8');
  assert.ok(!/process\.env\.TII_\w+\s*=/.test(src), 'the preflight must only ever READ process.env, never assign to a TII_* var');
});

test('preflight-production-issuance.js: the CLI entry point never overrides runTestSuite (no flag or env var can reach the stub)', () => {
  const src = fs.readFileSync(PREFLIGHT_SCRIPT, 'utf8');
  const cliBlock = src.slice(src.indexOf('if (require.main === module)'));
  assert.ok(/runPreflight\(\{\s*env:\s*process\.env,\s*candidateIdempotencyKey\s*\}\)/.test(cliBlock), 'the CLI entry point must call runPreflight() with only env/candidateIdempotencyKey — never runTestSuite');
  assert.ok(!/runTestSuite/.test(cliBlock), 'the CLI entry point source must never mention runTestSuite at all');
});

test('runPreflight(): setting the four policy flags ephemerally (no valid key) still correctly reports the gate as unsatisfied', () => {
  const childEnv = {
    ...process.env,
    TII_PRODUCTION_ISSUANCE_ENABLED: 'true',
    TII_GOVERNANCE_APPROVED: 'true',
    TII_RESOLVER_APPROVED: 'true',
    TII_IANA_GATE_SATISFIED: 'true',
    // deliberately no signing key -> signing_ready and checkpoint_current must still block
  };
  const result = runPreflight({ runTestSuite: fakePassingTestSuite, env: childEnv });
  const gateCheck = result.checks.find((c) => c.name.startsWith('production gate is NOT already satisfied'));
  assert.equal(gateCheck.ok, true, 'even with all four policy flags set, missing signing material must still keep the gate closed');
  assert.equal(gateCheck.detail.available, false);
  assert.ok(gateCheck.detail.blocked_by.includes('signing_ready'));

  // and confirm no leakage into a subsequent, ordinary, unmodified call
  const after = runPreflight({ runTestSuite: fakePassingTestSuite });
  const afterGateCheck = after.checks.find((c) => c.name.startsWith('production gate is NOT already satisfied'));
  assert.equal(afterGateCheck.detail.available, false);
});
