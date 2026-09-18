'use strict';

/**
 * Structured TIIAlreadyIssuedError (src/ledger.js) replaces message-string
 * matching as the control-flow discriminator for the generated-identifier
 * COLLISION retry loop in issueProductionTII() (src/production-issuance.js)
 * — a condition distinct from the idempotency conflict already covered by
 * IdempotencyConflictError (test/idempotency-conflict-error.test.js).
 *
 * INVARIANT (derived from implementation + the existing §10 collision
 * tests in test/production-gate.test.js, not from the message alone):
 * _validateAppend() (src/ledger.js) throws this specific error only when
 * appending a NEW `tii.issued` event whose candidate `tii` already exists
 * in the ledger — a pure 128-bit random-token collision, unrelated to
 * idempotency_key. issueProductionTII()'s retry loop discards exactly that
 * candidate and draws a fresh one via identifierProd.generateIdentifier(),
 * up to MAX_ATTEMPTS = 1000 attempts; the collided candidate is never
 * written, not even transiently. Every other error (idempotency conflict,
 * writer-lock timeout, recovery-required, any unrelated failure) must
 * propagate immediately, never retry.
 *
 * BEFORE this class existed, the retry loop discriminated with:
 *   /^TII already issued/.test(e.message)
 *
 * Tests 1, 9, 10 below use this repository's EXISTING deterministic
 * technique for exercising a real collision (monkeypatching
 * identifierProd.generateIdentifier to return a fixed, already-issued
 * token, then a fresh one) — the same pattern
 * test/production-gate.test.js's §10 tests already use, not a new
 * mechanism. Tests 2-8 use a one-shot, instance-scoped override of
 * `ledger.append()` (never a global prototype patch) to inject exact
 * error types/messages deterministically, matching
 * test/idempotency-conflict-error.test.js's established convention.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger, IdempotencyConflictError, TIIAlreadyIssuedError } = require('../src/ledger');
const { issueProductionTII } = require('../src/production-issuance');
const { WriterLockedError } = require('../src/writer-lock');
const { RecoveryRequiredError } = require('../src/recovery');
const identifierProd = require('../src/identifier');
const checkpointStore = require('../src/checkpoint-store');
const { generateKeypair } = require('../src/checkpoint');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-already-issued-'));
  return path.join(dir, 'ledger.jsonl');
}
const R = (id) => ({ id, kind: 'person' });

function gateSatisfiedEnv(ledger) {
  const kp = generateKeypair();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-already-issued-key-'));
  const keyFile = path.join(keyDir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  const checkpointDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-already-issued-ckpt-')), 'checkpoints');
  const env = {
    TII_PRODUCTION_ISSUANCE_ENABLED: 'true',
    TII_GOVERNANCE_APPROVED: 'true',
    TII_RESOLVER_APPROVED: 'true',
    TII_IANA_GATE_SATISFIED: 'true',
    TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile,
  };
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });
  return { env, checkpointDir };
}

/** One-shot: the NEXT call to `ledger.append()` is replaced by `fakeThrow`
 * (a function returning the error to throw), instead of the real append. */
function throwOnNextAppend(ledger, fakeThrow) {
  const originalAppend = Ledger.prototype.append.bind(ledger);
  ledger.append = function () {
    ledger.append = originalAppend;
    throw fakeThrow();
  };
}

/* ============================================== 1: real collision still retries === */

test('_validateAppend() throws a real TIIAlreadyIssuedError (not a plain Error) for a genuine token collision', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  l.issueTII({ recorder: R('a'), content: { note: 'x' } });
  const existingTii = l.events[0].tii;
  assert.throws(
    () => l.append({ tii: existingTii, event_type: 'tii.issued', recorder: R('b'), content: { note: 'y' } }),
    (e) => e instanceof TIIAlreadyIssuedError && e.code === 'tii-already-issued' && e.tii === existingTii
  );
});

test('issueProductionTII(): a real collision (via the repository\'s existing generateIdentifier() monkeypatch technique) still enters the retry path and succeeds', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  const collideWith = 'tii:' + 'z'.repeat(25) + 'z';
  const fresh = 'tii:' + 'y'.repeat(25) + 'y';
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => collideWith;
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }); // pre-occupy collideWith
  } finally {
    identifierProd.generateIdentifier = original;
  }
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });

  let calls = 0;
  identifierProd.generateIdentifier = () => {
    calls++;
    return calls === 1 ? collideWith : fresh;
  };
  try {
    const result = issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') });
    assert.equal(result.tii, fresh, 'the collided candidate was discarded and a fresh one minted');
    assert.equal(calls, 2, 'exactly one collision was discovered and exactly one retry occurred');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

/* ============================================== 2/3: text vs type === */

test('issueProductionTII(): a PLAIN Error carrying the exact historical "TII already issued" message does NOT enter the retry path', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return 'tii:' + 'p'.repeat(25) + 'p';
  };
  throwOnNextAppend(ledger, () => new Error('TII already issued: tii:' + 'p'.repeat(25) + 'p'));

  try {
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }),
      (e) => !(e instanceof TIIAlreadyIssuedError) && /^TII already issued/.test(e.message)
    );
    assert.equal(calls, 1, 'must NOT retry — exactly one candidate was drawn, no second attempt');
  } finally {
    identifierProd.generateIdentifier = original;
  }

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.event_type === 'tii.issued').length, 0, 'nothing was appended');
});

test('issueProductionTII(): a TIIAlreadyIssuedError with a DELIBERATELY DIFFERENT message still enters the retry path', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  const fresh = 'tii:' + 'q'.repeat(25) + 'q';
  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return calls === 1 ? 'tii:' + 'r'.repeat(25) + 'r' : fresh;
  };
  throwOnNextAppend(ledger, () => new TIIAlreadyIssuedError('a totally different wording sharing no text with the original message', { tii: 'tii:' + 'r'.repeat(25) + 'r' }));

  try {
    const result = issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') });
    assert.equal(result.tii, fresh, 'recovery from the fake-thrown collision succeeded by drawing a fresh candidate');
    assert.equal(calls, 2, 'the retry loop fired exactly once in response to the structured error, regardless of its wording');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

/* ============================================== 4/8: unrelated errors remain fatal === */

test('issueProductionTII(): an unrelated filesystem error (ENOSPC) remains fatal, never retried', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return 'tii:' + 's'.repeat(25) + 's';
  };
  throwOnNextAppend(ledger, () => {
    const e = new Error('ENOSPC: no space left on device, write');
    e.code = 'ENOSPC';
    return e;
  });

  try {
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }),
      (e) => e.code === 'ENOSPC'
    );
    assert.equal(calls, 1, 'must not retry an unrelated failure');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

/* ============================================== 5/6/7: other structured errors not mistaken === */

test('issueProductionTII(): IdempotencyConflictError is not mistaken for a token collision (no retry loop entry)', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);
  const key = 'NOT-A-COLLISION-KEY';

  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return 'tii:' + 't'.repeat(25) + 't';
  };
  throwOnNextAppend(ledger, () => new IdempotencyConflictError(`idempotency_key "${key}" was already used for a different operation`, { idempotencyKey: key }));

  try {
    // No matching persisted event exists for this key, so idempotency
    // recovery also cannot resolve it -- it must propagate, not retry.
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t'), idempotency_key: key }),
      (e) => e instanceof IdempotencyConflictError
    );
    assert.equal(calls, 1, 'an idempotency conflict must never be treated as a token collision and retried');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

test('issueProductionTII(): WriterLockedError is not mistaken for a token collision (no retry loop entry)', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return 'tii:' + 'u'.repeat(25) + 'u';
  };
  throwOnNextAppend(ledger, () => new WriterLockedError('writer lock is held — refusing to write', { pid: 1 }));

  try {
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }),
      (e) => e instanceof WriterLockedError
    );
    assert.equal(calls, 1, 'a writer-lock timeout must never be treated as a token collision and retried');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

test('issueProductionTII(): RecoveryRequiredError is not mistaken for a token collision (no retry loop entry)', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);

  let calls = 0;
  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => {
    calls++;
    return 'tii:' + 'v'.repeat(25) + 'v';
  };
  throwOnNextAppend(ledger, () => new RecoveryRequiredError('ledger requires explicit recovery before further writes', {}));

  try {
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }),
      (e) => e instanceof RecoveryRequiredError
    );
    assert.equal(calls, 1, 'a recovery-required state must never be treated as a token collision and retried');
  } finally {
    identifierProd.generateIdentifier = original;
  }
});

/* ============================================== 9: no duplicate ledger events === */

test('the retry path cannot produce a duplicate ledger event: a collided-and-discarded candidate never appears twice, even transiently on disk', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);
  const collideWith = 'tii:' + 'm'.repeat(25) + 'm';
  const fresh = 'tii:' + 'n'.repeat(25) + 'n';

  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => collideWith;
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') });
  } finally {
    identifierProd.generateIdentifier = original;
  }
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });

  let calls = 0;
  identifierProd.generateIdentifier = () => {
    calls++;
    return calls === 1 ? collideWith : fresh;
  };
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') });
  } finally {
    identifierProd.generateIdentifier = original;
  }

  const rawLedgerText = fs.readFileSync(file, 'utf8');
  const collideCount = (rawLedgerText.match(new RegExp(collideWith, 'g')) || []).length;
  assert.equal(collideCount, 1, 'the collided candidate must appear in the raw ledger exactly once — never duplicated by a discarded retry attempt');
  const final = new Ledger(file).load();
  assert.equal(final.verify().ok, true);
});

/* ============================================== 10: retry limit unchanged === */

test('retry limit is unchanged: exhausting MAX_ATTEMPTS on a persistent (simulated) collision still fails with the existing "collision retries exhausted" error, not a hang or an infinite loop', () => {
  const file = tmpFile();
  const ledger = new Ledger(file).load();
  const { env, checkpointDir } = gateSatisfiedEnv(ledger);
  const alwaysCollide = 'tii:' + 'w'.repeat(25) + 'w';

  const original = identifierProd.generateIdentifier;
  identifierProd.generateIdentifier = () => alwaysCollide;
  try {
    issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }); // pre-occupy the only candidate this test will ever generate
  } finally {
    identifierProd.generateIdentifier = original;
  }
  checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });

  identifierProd.generateIdentifier = () => alwaysCollide; // every subsequent draw collides, forever
  try {
    assert.throws(
      () => issueProductionTII(ledger, { env, checkpointDir, recorder: R('t') }),
      /collision retries exhausted/
    );
  } finally {
    identifierProd.generateIdentifier = original;
  }

  const final = new Ledger(file).load();
  const collideCount = (fs.readFileSync(file, 'utf8').match(new RegExp(alwaysCollide, 'g')) || []).length;
  assert.equal(collideCount, 1, 'even after exhausting every retry attempt, the persistently-colliding candidate was never duplicated');
});

/* ============================================== residual message-control-flow scan === */

test('source scan: no remaining .test(e.message) control flow for the TII-already-issued collision anywhere in src/', () => {
  const ledgerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  const prodSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'production-issuance.js'), 'utf8');
  assert.ok(!/\.test\(e\.message\)/.test(ledgerSrc), 'src/ledger.js: no .message-based control flow remains');
  assert.ok(!/\.test\(e\.message\)/.test(prodSrc), 'src/production-issuance.js: no .message-based control flow remains at all now');
  assert.ok(/e instanceof TIIAlreadyIssuedError/.test(prodSrc), 'the collision retry loop checks the structured type');
});
