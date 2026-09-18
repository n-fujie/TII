#!/usr/bin/env node
'use strict';
/**
 * PRE-ISSUANCE PREFLIGHT — read-only repository health check.
 *
 * PREFLIGHT PASSED DOES NOT MEAN ISSUANCE AUTHORIZED. A successful
 * preflight establishes only that the repository is in a state suitable
 * for human review. It does not authorize or execute production
 * issuance. Every future production issuance still requires its own
 * fresh human review and explicit ephemeral execution
 * (spec/production-issuance-sop.md) — this script is not a substitute
 * for any step of that process.
 *
 * SAFETY (do not weaken when editing this file):
 *   - Never imports src/production-issuance.js — structurally incapable
 *     of issuing, reserving, or replaying anything.
 *   - May import src/production-gate.js's computeGateStatus() — a pure,
 *     side-effect-free read of already-set environment variables,
 *     identical to what `tii production-status` already does. This
 *     script never itself sets, exports, or persists any TII_* variable
 *     — it only reads whatever is already present, specifically to catch
 *     an ACCIDENTAL, unintended persistence of gate-satisfying state.
 *   - Never resolves or references a signing-key passphrase. Only
 *     reports whether a key-related env var is PRESENT (boolean) and
 *     whether a referenced key FILE exists on disk — never its content.
 *   - No file is written, moved, or deleted by this script.
 *   - Exits non-zero on ANY failed check (fail closed).
 *
 * CLI usage (the ONLY way this script is meant to be run for a real
 * preflight — always uses the real, unmodified test-suite check below):
 *   node scripts/preflight-production-issuance.js
 *   node scripts/preflight-production-issuance.js --idempotency-key <key>
 *
 * TESTABILITY NOTE: runPreflight() below accepts an optional `runTestSuite`
 * override, but it is reachable ONLY via `require('./preflight-production-
 * issuance.js').runPreflight(...)` from code in this repository (see
 * test/post-issuance-hardening.test.js) — never via any CLI flag or
 * environment variable. The `node scripts/preflight-production-issuance.js`
 * entry point at the bottom of this file always calls runPreflight() with
 * no override, so no real invocation of this script can ever skip or
 * fake the test-suite check. This exists purely so the test suite is not
 * forced to nest an entire extra nested `npm test` run for every
 * scenario it exercises -- doing so was found to add enough concurrent
 * process load to intermittently starve unrelated, genuinely
 * timing-sensitive concurrency tests elsewhere in this same suite.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const { Ledger } = require(path.join(REPO, 'src/ledger.js'));
const checkpointStore = require(path.join(REPO, 'src/checkpoint-store.js'));
const gate = require(path.join(REPO, 'src/production-gate.js'));

const DISCLAIMER = 'PREFLIGHT PASSED does not mean ISSUANCE AUTHORIZED. A successful preflight establishes only that the repository is in a state suitable for human review. It does not authorize or execute production issuance.';

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: REPO, encoding: 'utf8' }).trim();
}

function realRunTestSuite() {
  try {
    const out = execFileSync('npm', ['test'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const totalMatch = out.match(/ℹ tests (\d+)/);
    return { total: totalMatch && Number(totalMatch[1]), pass: passMatch && Number(passMatch[1]), fail: failMatch && Number(failMatch[1]) };
  } catch (e) {
    return { total: null, pass: null, fail: null, error: 'test run failed to complete', message: e.message };
  }
}

/**
 * Runs every preflight check and returns { preflight_passed, disclaimer,
 * checks }. `runTestSuite` defaults to actually shelling out to `npm test`
 * (see TESTABILITY NOTE above for why and how narrowly this is overridable).
 */
function runPreflight({ env = process.env, candidateIdempotencyKey = null, runTestSuite = realRunTestSuite } = {}) {
  const results = [];
  let failed = false;
  function check(name, ok, detail, { warningOnly = false } = {}) {
    results.push({ name, ok, warningOnly, detail });
    if (!ok && !warningOnly) failed = true;
  }

  /* --------------------------------------------------- 1. clean tree --- */
  const porcelain = git(['status', '--porcelain']);
  check('working tree is clean', porcelain === '', { dirty_entries: porcelain ? porcelain.split('\n') : [] });

  /* --------------------------------------------------- 2. test suite --- */
  const testResult = runTestSuite();
  check('complete test suite passes', testResult.fail === 0 && testResult.pass === testResult.total && testResult.total != null, testResult);

  /* --------------------------------------------------- 3. ledger integrity --- */
  const ledgerFile = path.join(REPO, 'data', 'ledger.jsonl');
  const ledger = new Ledger(ledgerFile).load();
  const chain = ledger.verify();
  check('ledger chain integrity', chain.ok === true, chain);
  check('ledger recovery not required', ledger.recovery.required !== true, ledger.recovery);

  /* --------------------------------------------------- 4. checkpoint integrity --- */
  const checkpointDir = path.join(REPO, 'checkpoints');
  const checkpointFiles = fs.existsSync(checkpointDir) ? fs.readdirSync(checkpointDir).filter((f) => f.startsWith('checkpoint-') && f.endsWith('.json')) : [];
  let allCheckpointsVerify = true;
  for (const f of checkpointFiles) {
    try {
      const v = checkpointStore.verifyCheckpoint(ledger, { dir: checkpointDir, file: f });
      if (v.status !== 'VERIFIED') allCheckpointsVerify = false;
    } catch {
      allCheckpointsVerify = false;
    }
  }
  check('every existing checkpoint file verifies against its public key', checkpointFiles.length === 0 || allCheckpointsVerify, { count: checkpointFiles.length });

  /* --------------------------------------------------- 5. uniqueness --- */
  const allTiis = ledger.listTIIs();
  const uniqueTiis = new Set(allTiis);
  check('no duplicate TII identifiers in the ledger', allTiis.length === uniqueTiis.size, { total: allTiis.length, unique: uniqueTiis.size });

  const idempotencyKeysSeen = new Map(); // key -> [tii,...]
  for (const e of ledger.events) {
    if (e.idempotency_key) {
      const list = idempotencyKeysSeen.get(e.idempotency_key) || [];
      list.push(e.tii);
      idempotencyKeysSeen.set(e.idempotency_key, list);
    }
  }
  const crossedKeys = [...idempotencyKeysSeen.entries()].filter(([, tiis]) => new Set(tiis).size > 1);
  check('no idempotency key is associated with more than one distinct TII', crossedKeys.length === 0, { crossed: crossedKeys });

  if (candidateIdempotencyKey) {
    const alreadyUsed = idempotencyKeysSeen.has(candidateIdempotencyKey);
    check(`proposed idempotency key "${candidateIdempotencyKey}" is not already used`, !alreadyUsed, { already_used: alreadyUsed });
  } else {
    results.push({ name: 'proposed idempotency key uniqueness', ok: null, warningOnly: true, detail: { note: 'not checked -- no --idempotency-key argument given' } });
  }

  /* ------------------------------------------- 6. configuration shape, no values --- */
  const configPresence = {
    TII_CHECKPOINT_PRIVATE_KEY: !!env.TII_CHECKPOINT_PRIVATE_KEY,
    TII_CHECKPOINT_PRIVATE_KEY_FILE: !!env.TII_CHECKPOINT_PRIVATE_KEY_FILE,
    TII_CHECKPOINT_PRIVATE_KEY_FILE_exists_on_disk: env.TII_CHECKPOINT_PRIVATE_KEY_FILE ? fs.existsSync(env.TII_CHECKPOINT_PRIVATE_KEY_FILE) : null,
    TII_CHECKPOINT_KEY_PASSPHRASE_present: !!env.TII_CHECKPOINT_KEY_PASSPHRASE,
    TII_CHECKPOINT_KEY_PASSPHRASE_FILE_present: !!env.TII_CHECKPOINT_KEY_PASSPHRASE_FILE,
  };
  results.push({ name: 'configuration presence report (booleans/paths only, no values)', ok: null, warningOnly: true, detail: configPresence });

  /* --------------------------------------- 7. gate not accidentally persisted --- */
  // Pure read of already-set environment variables via the existing,
  // unmodified computeGateStatus() -- identical to `tii production-status`.
  // This script never sets any of these itself.
  const gateStatus = gate.computeGateStatus({ ledgerFile, checkpointDir, env });
  check(
    'production gate is NOT already satisfied in this ambient shell (no accidental persistence)',
    gateStatus.available === false,
    { available: gateStatus.available, blocked_by: gateStatus.blocked_by, warning: gateStatus.available ? 'the gate reads AVAILABLE in this shell outside of a deliberate, reviewed, ephemeral issuance -- investigate before proceeding with anything' : undefined }
  );

  /* --------------------------------------- 8. consistency: reuse the existing verifier --- */
  const verifierScript = path.join(__dirname, 'verify-first-production-issuance.js');
  let firstIssuanceVerified = null;
  if (fs.existsSync(verifierScript)) {
    try {
      execFileSync('node', [verifierScript], { cwd: REPO, stdio: 'ignore' });
      firstIssuanceVerified = true;
    } catch {
      firstIssuanceVerified = false;
    }
    check('first-production-issuance evidence still independently verifies (delegates to verify-first-production-issuance.js, not reimplemented)', firstIssuanceVerified === true, { script: path.relative(REPO, verifierScript) });
  } else {
    results.push({ name: 'first-production-issuance verifier present', ok: null, warningOnly: true, detail: { note: 'scripts/verify-first-production-issuance.js not found -- skipped' } });
  }

  return { preflight_passed: !failed, disclaimer: DISCLAIMER, checks: results };
}

module.exports = { runPreflight };

/* --------------------------------------------------------------- CLI --- */
if (require.main === module) {
  const args = process.argv.slice(2);
  const idxKey = args.indexOf('--idempotency-key');
  const candidateIdempotencyKey = idxKey !== -1 ? args[idxKey + 1] : null;

  const result = runPreflight({ env: process.env, candidateIdempotencyKey });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.preflight_passed ? 0 : 1);
}
