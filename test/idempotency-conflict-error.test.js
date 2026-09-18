'use strict';

/**
 * Structured IdempotencyConflictError (src/ledger.js) replaces
 * message-string matching as the control-flow discriminator for
 * idempotency replay-recovery in both Ledger.issueTII() and
 * issueProductionTII() (src/production-issuance.js).
 *
 * BEFORE this class existed, both recovery sites discriminated the
 * recoverable condition with:
 *   /^idempotency_key ".*" was already used for a different operation$/
 *     .test(e.message)
 * — a human-readable message used as an implicit type marker. That is
 * fragile in both directions: (a) any OTHER error that happened to carry
 * matching text would have been wrongly treated as recoverable, and (b)
 * editing the wording for clarity would have silently broken recovery.
 *
 * This file proves the discriminator is now the error's TYPE
 * (`instanceof IdempotencyConflictError`, mirrored by a stable `.code`),
 * completely decoupled from its `.message`:
 *   - a plain Error carrying the exact historical message text must NOT
 *     be treated as recoverable (proves type, not text, decides);
 *   - an IdempotencyConflictError with a deliberately different message
 *     must still be recovered correctly (proves the message is no longer
 *     load-bearing for control flow);
 *   - WriterLockedError and RecoveryRequiredError — both real, distinct
 *     structured errors already used elsewhere in this codebase — must
 *     never be treated as idempotency-recoverable, regardless of message
 *     text.
 *
 * All races are forced deterministically via one-shot, instance-scoped
 * method overrides (never a global prototype patch) — no sleeps, no OS
 * scheduling dependency, consistent with
 * test/generic-issuance-replay-recovery.test.js and
 * test/ledger-concurrency-read-race.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger, IdempotencyConflictError } = require('../src/ledger');
const { issueProductionTII } = require('../src/production-issuance');
const { WriterLockedError } = require('../src/writer-lock');
const { RecoveryRequiredError } = require('../src/recovery');
const checkpointStore = require('../src/checkpoint-store');
const { generateKeypair } = require('../src/checkpoint');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-idempotency-error-'));
  return path.join(dir, 'ledger.jsonl');
}
const R = (id) => ({ id, kind: 'person' });

function gateSatisfiedEnv(ledger) {
  const kp = generateKeypair();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-idempotency-error-key-'));
  const keyFile = path.join(keyDir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  const checkpointDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-idempotency-error-ckpt-')), 'checkpoints');
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

/** One-shot: the NEXT call to `victim.append()` is replaced by `fakeThrow`
 * (a function returning the error to throw), instead of the real append.
 * First reloads `victim` from disk -- modeling the resync the REAL
 * append() always performs (src/ledger.js's _resyncIfChanged(), inside the
 * writer lock) before it can ever throw the post-resync idempotency
 * conflict -- so the catch block's own re-check sees genuinely current
 * state, exactly as it would for a real throw. Without this, a fake throw
 * injected before the pre-check's own view of the ledger ever changes
 * would trivially fail any content-based recovery check for reasons
 * unrelated to what's actually being tested (the error TYPE). */
function throwOnNextAppend(victim, fakeThrow) {
  const originalAppend = Ledger.prototype.append.bind(victim);
  victim.append = function () {
    victim.append = originalAppend;
    victim.load();
    throw fakeThrow();
  };
}

/** One-shot: the NEXT call to `victim.append()` first lets a fully
 * independent Ledger instance commit the same idempotency_key/content
 * (modeling a concurrent winner), then proceeds with the real append. */
function loseRaceOnNextAppend(victim, concurrentWrite) {
  const originalAppend = Ledger.prototype.append.bind(victim);
  victim.append = function (partial) {
    victim.append = originalAppend;
    concurrentWrite();
    return originalAppend(partial);
  };
}

/* ============================================== structured error, generic path === */

test('_validateAppend() throws a real IdempotencyConflictError (not a plain Error) for same-key/different-content', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  l.issueTII({ recorder: R('a'), content: { note: 'x' }, idempotency_key: 'K' });
  assert.throws(
    () => l.issueTII({ recorder: R('b'), content: { note: 'DIFFERENT' }, idempotency_key: 'K' }),
    (e) => e instanceof IdempotencyConflictError && e.code === 'idempotency-conflict' && e.idempotencyKey === 'K'
  );
});

test('issueTII(): recovery still works with the structured error after losing a race to a concurrent winner', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-1';
  const content = { note: 'x' };
  let winnerEvent;

  loseRaceOnNextAppend(victim, () => {
    const winner = new Ledger(file).load();
    winnerEvent = winner.issueTII({ recorder: R('concurrent'), content, idempotency_key: key }).event;
  });

  const result = victim.issueTII({ recorder: R('victim'), content, idempotency_key: key });
  assert.equal(result.idempotent_replay, true);
  assert.deepEqual(result.event, winnerEvent);

  const final = new Ledger(file).load();
  assert.equal(final.events.length, 1, 'no extra event appended during recovery');
  assert.equal(final.verify().ok, true);
});

test('issueTII(): a PLAIN Error carrying the exact historical message text does NOT trigger recovery (type, not text, decides)', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-2';
  const content = { note: 'x' };

  // A genuinely matching, content-equivalent event DOES exist under this
  // key -- if the discriminator were still message-based, this would be
  // silently "recovered". It must not be, because the thrown error is a
  // plain Error, not an IdempotencyConflictError.
  const matching = new Ledger(file).load().issueTII({ recorder: R('other'), content, idempotency_key: key }).event;

  throwOnNextAppend(victim, () => new Error(`idempotency_key "${key}" was already used for a different operation`));

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content, idempotency_key: key }),
    (e) => !(e instanceof IdempotencyConflictError) && /was already used for a different operation/.test(e.message)
  );
  const final = new Ledger(file).load();
  assert.equal(final.events.length, 1, 'still only the pre-existing matching event -- nothing fabricated, nothing appended');
  assert.deepEqual(final.events[0], matching);
});

test('issueTII(): an IdempotencyConflictError with a DELIBERATELY DIFFERENT message is still recognized and recovered', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-3';
  const content = { note: 'x' };

  const matching = new Ledger(file).load().issueTII({ recorder: R('other'), content, idempotency_key: key }).event;

  throwOnNextAppend(victim, () => new IdempotencyConflictError('a totally different wording that shares no text with the original message', { idempotencyKey: key }));

  const result = victim.issueTII({ recorder: R('victim'), content, idempotency_key: key });
  assert.equal(result.idempotent_replay, true, 'recovery must succeed based on error TYPE, regardless of message wording');
  assert.deepEqual(result.event, matching);

  const final = new Ledger(file).load();
  assert.equal(final.events.length, 1);
});

test('issueTII(): a real WriterLockedError never triggers replay recovery', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-WRITERLOCK';
  const content = { note: 'x' };
  new Ledger(file).load().issueTII({ recorder: R('other'), content, idempotency_key: key }); // a matching event DOES exist

  throwOnNextAppend(victim, () => new WriterLockedError('writer lock is held by pid 1 on host since now — refusing to write', { pid: 1 }));

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content, idempotency_key: key }),
    (e) => e instanceof WriterLockedError && e.code === 'writer-locked'
  );
});

test('issueTII(): a real RecoveryRequiredError never triggers replay recovery', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-RECOVERY';
  const content = { note: 'x' };
  new Ledger(file).load().issueTII({ recorder: R('other'), content, idempotency_key: key }); // a matching event DOES exist

  throwOnNextAppend(victim, () => new RecoveryRequiredError('ledger requires explicit recovery before further writes', { required: true }));

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content, idempotency_key: key }),
    (e) => e instanceof RecoveryRequiredError && e.code === 'recovery-required'
  );
});

test('issueTII(): an unrelated filesystem error (ENOSPC) still propagates, never swallowed', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-KEY-ENOSPC';
  const content = { note: 'x' };
  new Ledger(file).load().issueTII({ recorder: R('other'), content, idempotency_key: key }); // a matching event DOES exist

  throwOnNextAppend(victim, () => {
    const e = new Error('ENOSPC: no space left on device, write');
    e.code = 'ENOSPC';
    return e;
  });

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content, idempotency_key: key }),
    (e) => e.code === 'ENOSPC'
  );
});

/* ============================================== structured error, production path === */

test('issueProductionTII(): recovery still works with the structured error after losing a race to a concurrent winner', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'STRUCT-PROD-1';
  const content = { note: 'x' };
  const seedBaseline = new Ledger(file).load();
  seedBaseline.issueTII({ recorder: R('seed') });
  const { env, checkpointDir } = gateSatisfiedEnv(seedBaseline);
  let winnerEvent;

  loseRaceOnNextAppend(victim, () => {
    const winner = new Ledger(file).load();
    winnerEvent = issueProductionTII(winner, { env, checkpointDir, recorder: R('concurrent'), content, idempotency_key: key }).event;
  });

  const result = issueProductionTII(victim, { env, checkpointDir, recorder: R('victim'), content, idempotency_key: key });
  assert.equal(result.idempotent_replay, true);
  assert.deepEqual(result.event, winnerEvent);

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 1);
  assert.equal(final.verify().ok, true);
});

test('issueProductionTII(): a PLAIN Error carrying the exact historical message text does NOT trigger recovery', () => {
  const file = tmpFile();
  const seed = new Ledger(file).load();
  seed.issueTII({ recorder: R('seed') });
  const { env, checkpointDir } = gateSatisfiedEnv(seed);
  const key = 'STRUCT-PROD-2';
  const content = { note: 'x' };

  // `victim` is constructed BEFORE the matching event exists, so
  // issueProductionTII()'s own PRE-CHECK (which runs before append() is
  // ever called) genuinely misses and does not short-circuit -- this test
  // must exercise the POST-THROW catch-block recovery path specifically,
  // not the earlier pre-check.
  const victim = new Ledger(file).load();

  const matching = new Ledger(file).load();
  const matchingResult = issueProductionTII(matching, { env, checkpointDir, recorder: R('other'), content, idempotency_key: key });

  throwOnNextAppend(victim, () => new Error(`idempotency_key "${key}" was already used for a different operation`));

  assert.throws(
    () => issueProductionTII(victim, { env, checkpointDir, recorder: R('victim'), content, idempotency_key: key }),
    (e) => !(e instanceof IdempotencyConflictError) && /was already used for a different operation/.test(e.message)
  );

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 1);
  assert.equal(final.events.find((e) => e.idempotency_key === key).event_id, matchingResult.event.event_id, 'still just the one real winner, nothing fabricated');
});

test('issueProductionTII(): WriterLockedError and RecoveryRequiredError never trigger replay recovery', () => {
  const file = tmpFile();
  const seed = new Ledger(file).load();
  seed.issueTII({ recorder: R('seed') });
  const { env, checkpointDir } = gateSatisfiedEnv(seed);
  const key = 'STRUCT-PROD-3';
  const content = { note: 'x' };
  new Ledger(file).load(); // no issuance under this key yet -- irrelevant to whether these errors recover

  const victimA = new Ledger(file).load();
  throwOnNextAppend(victimA, () => new WriterLockedError('writer lock is held — refusing to write', { pid: 1 }));
  assert.throws(
    () => issueProductionTII(victimA, { env, checkpointDir, recorder: R('victim'), content, idempotency_key: key }),
    (e) => e instanceof WriterLockedError
  );

  const victimB = new Ledger(file).load();
  throwOnNextAppend(victimB, () => new RecoveryRequiredError('ledger requires explicit recovery before further writes', {}));
  assert.throws(
    () => issueProductionTII(victimB, { env, checkpointDir, recorder: R('victim'), content, idempotency_key: key }),
    (e) => e instanceof RecoveryRequiredError
  );

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 0, 'no event was ever fabricated for this key');
});

/* ============================================== residual message-driven control flow scan === */

test('source scan: idempotency replay-recovery control flow no longer parses e.message', () => {
  const ledgerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  const prodSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'production-issuance.js'), 'utf8');

  // The historical message string may still exist as the human-readable
  // text passed into IdempotencyConflictError's constructor -- that's fine,
  // required even (Phase 2: "preserve the current human-facing error
  // message"). What must NOT exist is a regex/`.message` TEST against it.
  assert.ok(!/\.test\(e\.message\)/.test(ledgerSrc), 'src/ledger.js: no .message-based control flow remains at all');

  // At the time this test was first written, src/production-issuance.js
  // still had ONE unrelated .test(e.message) check for a DIFFERENT
  // condition -- the authoritative TII token collision retry
  // (`/^TII already issued/`), explicitly out of scope for THIS task (it
  // is not the idempotency conflict). A later, separate task
  // ("replace TII collision message matching with structured error",
  // introducing TIIAlreadyIssuedError) removed that remaining occurrence
  // too -- see test/tii-already-issued-error.test.js for its own coverage.
  // Reflect that current reality here rather than asserting a stale count.
  assert.ok(!/\.test\(e\.message\)/.test(prodSrc), 'src/production-issuance.js: no .message-based control flow remains at all now');

  // Positive confirmation: the actual discriminator used is instanceof.
  assert.ok(/e instanceof IdempotencyConflictError/.test(ledgerSrc));
  assert.ok(/e instanceof IdempotencyConflictError/.test(prodSrc));
});
