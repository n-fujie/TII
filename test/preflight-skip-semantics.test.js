'use strict';

/**
 * scripts/preflight-production-issuance.js's test-readiness predicate.
 *
 * DEFECT FOUND (confirmed by running the real preflight from a genuinely
 * clean tree before this fix): the old predicate was
 *   testResult.fail === 0 && testResult.pass === testResult.total
 * `pass === total` can NEVER hold whenever any test is skipped, because
 * node's `--test` runner's `ℹ tests N` summary line counts skipped tests
 * too. This repository has exactly one deliberately, permanently opt-in
 * skip (test/ledger-concurrency-read-race.test.js's "optional slow
 * repro...", gated behind TII_RUN_SLOW_CONCURRENCY_REPRO=true) -- so the
 * old predicate made a completely healthy repository permanently
 * incapable of reaching PREFLIGHT PASSED under its own normal, supported
 * configuration. Observed directly: a clean-tree run reported
 * `{ total: 293, pass: 292, fail: 0 }` and the check still read `ok:
 * false`, with every other preflight check passing.
 *
 * CORRECTED INVARIANT (testSuiteReadiness(), exported for this test file):
 * NOT "passed + skipped === total" alone (that would accept a same-count
 * SUBSTITUTION of an unexpected skip for the known one) and NOT
 * "fail === 0" alone (that would accept unlimited unexplained skips).
 * Instead: zero failures, zero cancelled, zero todo; the reported skip
 * count agrees with the number of individually named skip lines parsed
 * from the real test-runner output (parser self-consistency); every
 * individually named skipped test is a member of the closed
 * KNOWN_INTENTIONAL_TEST_SKIPS allowlist, checked by exact string
 * identity, not count; and pass+fail+cancelled+skipped+todo reconciles
 * exactly to the reported total. Any missing/unparseable count fails
 * closed rather than defaulting to a permissive value.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runPreflight, testSuiteReadiness, parseTestSuiteOutput, KNOWN_INTENTIONAL_TEST_SKIPS } = require('../scripts/preflight-production-issuance.js');

const KNOWN_SKIP = 'optional slow repro: many real concurrent processes converge on one event under load';

function healthyResult(overrides = {}) {
  return {
    total: 293, pass: 292, fail: 0, cancelled: 0, todo: 0,
    skipped: 1, skippedNames: [KNOWN_SKIP],
    ...overrides,
  };
}

/* ==================================================== Phase 6.1/6.2: succeed cases === */

test('1. all tests passing, zero skipped -> succeeds', () => {
  const r = testSuiteReadiness({ total: 293, pass: 293, fail: 0, cancelled: 0, todo: 0, skipped: 0, skippedNames: [] });
  assert.equal(r.ok, true);
});

test('2. current normal suite shape (292 passed, 1 recognized intentional skip, 0 failed) -> succeeds', () => {
  const r = testSuiteReadiness(healthyResult());
  assert.equal(r.ok, true);
});

test('the exact currently-known intentional skip name is what the repository actually uses', () => {
  // Guards against KNOWN_INTENTIONAL_TEST_SKIPS silently drifting out of
  // sync with the real test file if that test's title is ever edited.
  const src = fs.readFileSync(path.join(__dirname, 'ledger-concurrency-read-race.test.js'), 'utf8');
  assert.ok(src.includes(`test('${KNOWN_SKIP}'`), 'the allowlisted skip name must match the real test title verbatim');
  assert.deepEqual(KNOWN_INTENTIONAL_TEST_SKIPS, [KNOWN_SKIP]);
});

/* ==================================================== Phase 6.3: real failure fails === */

test('3. one actual failure -> fails', () => {
  const r = testSuiteReadiness(healthyResult({ fail: 1, pass: 291 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /failed/);
});

/* ==================================================== Phase 6.4: unexpected skip fails === */

test('4. one unexpected skipped test (not on the allowlist, nothing else skipped) -> fails', () => {
  const r = testSuiteReadiness({ total: 293, pass: 292, fail: 0, cancelled: 0, todo: 0, skipped: 1, skippedNames: ['some other test nobody decided was intentional'] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unrecognized/);
});

/* ==================================================== Phase 6.5: known + extra fails === */

test('5. known intentional skip PLUS one additional unrecognized skip -> fails', () => {
  const r = testSuiteReadiness({ total: 294, pass: 292, fail: 0, cancelled: 0, todo: 0, skipped: 2, skippedNames: [KNOWN_SKIP, 'a second, unrelated skip'] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unrecognized/);
});

/* ==================================================== Phase 6.6: same count, wrong identity === */

test('6. same skip COUNT (1) but WRONG skipped-test identity -> fails (proves identity, not count, is checked)', () => {
  const r = testSuiteReadiness({ total: 293, pass: 292, fail: 0, cancelled: 0, todo: 0, skipped: 1, skippedNames: ['a completely different test that happens to also be the only skip'] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unrecognized/);
});

/* ==================================================== Phase 6.7: malformed output === */

test('7. malformed test output (unparseable) -> fails closed, never defaults to permissive', () => {
  const parsed = parseTestSuiteOutput('this is not anything node --test would ever print');
  assert.deepEqual(parsed, { total: null, pass: null, fail: null, skipped: null, cancelled: null, todo: null, skippedNames: [] });
  const r = testSuiteReadiness(parsed);
  assert.equal(r.ok, false);
  assert.match(r.reason, /incomplete or unparseable/);
});

test('7b. skip summary count disagrees with the number of individually named skip lines -> fails closed', () => {
  // e.g. output claiming "ℹ skipped 2" but only one `# SKIP` line was
  // actually parseable -- a parser/output inconsistency, not evidence of
  // a genuinely clean, fully-recognized skip set.
  const r = testSuiteReadiness(healthyResult({ skipped: 2, skippedNames: [KNOWN_SKIP] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /disagree/);
});

/* ==================================================== Phase 6.8: missing data === */

test('8. missing test-result data (fields absent entirely) -> fails closed', () => {
  const r = testSuiteReadiness({});
  assert.equal(r.ok, false);
  assert.match(r.reason, /incomplete or unparseable/);
});

test('8b. partially missing test-result data (skippedNames absent though skipped=1) -> fails closed', () => {
  const r = testSuiteReadiness({ total: 293, pass: 292, fail: 0, cancelled: 0, todo: 0, skipped: 1 /* skippedNames missing */ });
  assert.equal(r.ok, false);
});

/* ==================================================== Phase 6.9: non-zero runner exit === */

test('9. non-zero test-runner exit (execFileSync throw) -> fails, via the exact shape realRunTestSuite()\'s catch block produces', () => {
  // realRunTestSuite() is not exported (it always shells out for real —
  // see the TESTABILITY NOTE at the top of the script for why), but its
  // catch-block shape on a thrown/non-zero exit is simple and stable by
  // source inspection: every count null, skippedNames null, plus an
  // `error`/`message`. Confirm that exact shape fails closed.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'preflight-production-issuance.js'), 'utf8');
  assert.ok(/catch \(e\) \{\s*return \{ total: null, pass: null, fail: null, skipped: null, cancelled: null, todo: null, skippedNames: null,/.test(src), 'realRunTestSuite()\'s catch block must still produce this exact all-null shape on a non-zero exit');
  const r = testSuiteReadiness({ total: null, pass: null, fail: null, skipped: null, cancelled: null, todo: null, skippedNames: null, error: 'test run failed to complete', message: 'Command failed: npm test' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /incomplete or unparseable/);
});

/* ==================================================== end-to-end: runPreflight() wiring === */

test('runPreflight(): the "complete test suite passes" check is wired to testSuiteReadiness(), not a stale inline predicate', () => {
  const passResult = runPreflight({ runTestSuite: () => healthyResult() });
  const passCheck = passResult.checks.find((c) => c.name === 'complete test suite passes');
  assert.equal(passCheck.ok, true);
  assert.equal(passCheck.detail.reason, 'all executed tests passed; every skipped test is a recognized intentional opt-in');

  const failResult = runPreflight({ runTestSuite: () => ({ total: 293, pass: 292, fail: 0, cancelled: 0, todo: 0, skipped: 1, skippedNames: ['unexpected'] }) });
  const failCheck = failResult.checks.find((c) => c.name === 'complete test suite passes');
  assert.equal(failCheck.ok, false);
  assert.equal(failResult.preflight_passed, false);
});

/* ==================================================== Phase 6.10/11/12: safety invariants === */

test('10. a permitted skip in the test-suite check does not, by itself, satisfy or imply issuance authorization', () => {
  // Even with a fully "healthy" (recognized-skip-only) test-suite result,
  // runPreflight() must still report the disclaimer and must still gate
  // preflight_passed on every OTHER check (clean tree, ledger, checkpoints,
  // gate-not-persisted, etc.) -- passing the test-suite check alone proves
  // nothing about authorization.
  const result = runPreflight({ runTestSuite: () => healthyResult() });
  assert.equal(result.disclaimer, 'PREFLIGHT PASSED does not mean ISSUANCE AUTHORIZED. A successful preflight establishes only that the repository is in a state suitable for human review. It does not authorize or execute production issuance.');
  assert.ok(result.checks.length > 1, 'other checks (ledger, checkpoints, gate, etc.) still ran and still gate the overall result');
});

test('11. preflight does not persist the production gate as a side effect of skip validation', () => {
  const gate = require('../src/production-gate.js');
  const before = gate.computeGateStatus({ ledgerFile: path.join(__dirname, '..', 'data', 'ledger.jsonl'), env: process.env });
  runPreflight({ runTestSuite: () => healthyResult() });
  const after = gate.computeGateStatus({ ledgerFile: path.join(__dirname, '..', 'data', 'ledger.jsonl'), env: process.env });
  assert.equal(before.available, false);
  assert.equal(after.available, false);
  assert.deepEqual(after.blocked_by, before.blocked_by);
});

test('12. preflight never imports or is capable of invoking the production issuance path as part of skip validation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'preflight-production-issuance.js'), 'utf8');
  assert.ok(!/require\(.*production-issuance/.test(src), 'the preflight (including its skip-validation logic) must never be able to invoke real issuance');
});
