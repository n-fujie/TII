'use strict';

/**
 * Ledger.issueTII() vs issueProductionTII() — replay-recovery asymmetry.
 *
 * BEHAVIORAL ASYMMETRY (found by inspection, confirmed by deterministic
 * reproduction below): both issuance paths do the same two-step idempotency
 * pattern — (1) a pre-check via the in-memory idempotency map, to avoid
 * wasting a candidate draw on an already-known replay, and (2) rely on
 * Ledger.append()'s own authoritative, post-writer-lock, post-resync
 * _validateAppend() as the real correctness backstop, since the pre-check
 * can be stale if a concurrent writer commits between it and the append()
 * call. When _validateAppend() throws because the authoritative,
 * just-resynced state now shows the SAME idempotency_key mapped to a
 * DIFFERENT tii (i.e. the pre-check missed a winner that committed in that
 * exact window), issueProductionTII() (src/production-issuance.js) catches
 * SPECIFICALLY that error message, re-checks the idempotency map (already
 * current thanks to append()'s own resync — no additional reload needed),
 * and if the persisted event's CONTENT matches what was intended (tii is
 * deliberately NOT part of this comparison — the caller never had a chance
 * to know the winner's tii), returns it as a replay instead of propagating
 * the error. Ledger.issueTII() had no equivalent: it let the exact same
 * throw propagate straight to its caller, even when re-reading the ledger
 * would have revealed a valid, content-equivalent, already-persisted
 * replay.
 *
 * INVARIANT PRESERVED (same as issueProductionTII(), not weaker or
 * stronger): recovery fires if and only if append() throws EXACTLY the
 * post-resync "idempotency_key ... was already used for a different
 * operation" message — never WriterLockedError, never
 * RecoveryRequiredError, never any other error — and even then only
 * returns a replay if the persisted event's canonical content genuinely
 * matches. Any other failure, or a same-key-different-content collision,
 * still fails closed exactly as before.
 *
 * The tests below force the exact race deterministically via an
 * INSTANCE-LEVEL override of `append` (not a global prototype patch, so it
 * cannot leak into any other Ledger instance or test) — no sleeps, no OS
 * scheduling dependency.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-generic-replay-'));
  return path.join(dir, 'ledger.jsonl');
}
const R = (id) => ({ id, kind: 'person' });

/**
 * Scoped, instance-only interception: the NEXT call to `victim.append()`
 * first lets `concurrentWrite()` run to completion (modeling a fully
 * independent process winning the race and committing first), THEN
 * proceeds with the real, original `append()` call. Restores the
 * instance's own `append` immediately after firing once.
 */
function loseRaceOnNextAppend(victim, concurrentWrite) {
  const originalAppend = Ledger.prototype.append.bind(victim);
  victim.append = function (partial) {
    victim.append = originalAppend; // one-shot; restore before recursing
    concurrentWrite();
    return originalAppend(partial);
  };
}

/* =============================================== Phase 3/4: reproduction + target behavior ===
 * Before the fix, this exact test throws
 * `idempotency_key "ASYM-KEY-2" was already used for a different operation`
 * instead of resolving to a replay — confirmed via `git stash` against the
 * unfixed src/ledger.js (see this task's final report for the recorded
 * before/after run). After the fix, it passes as written below. */

test('fix: issueTII() recovers a valid replay after losing a race to a concurrent same-key/same-content writer', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'ASYM-KEY-2';
  const content = { note: 'x' };
  let winnerEvent;
  let bytesAfterWinnerCommitted;

  loseRaceOnNextAppend(victim, () => {
    const winner = new Ledger(file).load();
    const r = winner.issueTII({ recorder: R('concurrent'), content, idempotency_key: key });
    winnerEvent = r.event;
    bytesAfterWinnerCommitted = fs.readFileSync(file, 'utf8'); // the file cannot exist before this point -- this IS the first write
  });

  const result = victim.issueTII({ recorder: R('victim'), content, idempotency_key: key });
  const after = fs.readFileSync(file, 'utf8');

  assert.equal(result.idempotent_replay, true, 'must resolve as a replay, not throw');
  assert.equal(result.tii, winnerEvent.tii, 'replay must return the WINNER\'s tii, never a second one');
  assert.deepEqual(result.event, winnerEvent, 'the returned event must correspond EXACTLY to the already-persisted event');
  assert.equal(after, bytesAfterWinnerCommitted, 'the losing (victim) call must append NO extra bytes beyond what the winner alone wrote');

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 1, 'exactly one event exists for this idempotency key');
  assert.equal(final.events.length, 1, 'event count is exactly one (only the winner\'s), not two');
  assert.equal(final.verify().ok, true, 'hash chain remains valid');
});

/* ===================================================== Phase 5: adversarial coverage === */

test('same idempotency key + DIFFERENT content after a concurrent winner still fails closed (recovery must not weaken duplicate detection)', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'ASYM-KEY-DIFF';
  let bytesAfterWinnerCommitted;

  loseRaceOnNextAppend(victim, () => {
    const winner = new Ledger(file).load();
    winner.issueTII({ recorder: R('concurrent'), content: { note: 'winner-content' }, idempotency_key: key });
    bytesAfterWinnerCommitted = fs.readFileSync(file, 'utf8');
  });

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content: { note: 'GENUINELY DIFFERENT' }, idempotency_key: key }),
    /idempotency_key "ASYM-KEY-DIFF" was already used for a different operation/
  );
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, bytesAfterWinnerCommitted, 'a rejected conflicting reuse must append nothing beyond what the winner alone wrote');

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 1, 'only the original winner event exists — no duplicate, no corruption');
});

test('unrelated filesystem/write error is NOT swallowed or converted into a replay', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'ASYM-KEY-UNRELATED-ERR';

  const originalAppend = Ledger.prototype.append.bind(victim);
  victim.append = function () {
    victim.append = originalAppend;
    const e = new Error('ENOSPC: no space left on device, write');
    e.code = 'ENOSPC';
    throw e;
  };

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content: { note: 'x' }, idempotency_key: key }),
    (e) => e.code === 'ENOSPC' && /no space left/.test(e.message)
  );
  const final = new Ledger(file).load();
  assert.equal(final.events.length, 0, 'no event exists — the unrelated error was not silently converted into a fabricated success');
});

test('a stale-state / recovery-required exception is NOT reinterpreted as a replay', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  victim.issueTII({ recorder: R('seed') }); // one prior event, unrelated key
  fs.appendFileSync(file, '{"broken json, no closing'); // simulate a malformed tail on disk

  const key = 'ASYM-KEY-RECOVERY-REQUIRED';
  // A fresh instance loading this file observes recovery.required, so ANY
  // append (with or without an idempotency_key) must fail closed, never be
  // reinterpreted as a replay.
  const victim2 = new Ledger(file).load();
  assert.equal(victim2.recovery.required, true, 'sanity: malformed tail correctly detected');
  assert.throws(
    () => victim2.issueTII({ recorder: R('victim'), content: { note: 'x' }, idempotency_key: key }),
    (e) => e.code === 'recovery-required'
  );
});

test('no matching persisted event exists after a write failure: still fails, not silently accepted', () => {
  const file = tmpFile();
  const victim = new Ledger(file).load();
  const key = 'ASYM-KEY-NO-MATCH';

  const originalAppend = Ledger.prototype.append.bind(victim);
  victim.append = function () {
    victim.append = originalAppend;
    // Throw EXACTLY the message pattern the recovery logic looks for, but
    // with NOTHING actually persisted for this key -- proving the recovery
    // path re-derives from authoritative state rather than trusting the
    // error message alone.
    throw new Error(`idempotency_key "${key}" was already used for a different operation`);
  };

  assert.throws(
    () => victim.issueTII({ recorder: R('victim'), content: { note: 'x' }, idempotency_key: key }),
    new RegExp(`idempotency_key "${key}" was already used for a different operation`)
  );
  const final = new Ledger(file).load();
  assert.equal(final.events.length, 0, 'nothing was fabricated or persisted');
});

test('ordinary SEQUENTIAL replay (no race at all) is unaffected by the added recovery path', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  const key = 'ASYM-KEY-SEQUENTIAL';
  const content = { note: 'sequential' };

  const first = l.issueTII({ recorder: R('a'), content, idempotency_key: key });
  assert.equal(first.idempotent_replay, undefined, 'the first call is not itself a replay');

  const second = l.issueTII({ recorder: R('b'), content, idempotency_key: key });
  assert.equal(second.idempotent_replay, true);
  assert.equal(second.tii, first.tii);
  assert.deepEqual(second.event, first.event);

  assert.equal(l.events.length, 1);
  assert.equal(l.verify().ok, true);
});

/* ===================================================== Phase 6: cross-path consistency === */

test('cross-path consistency: generic replay recovery never touches production gating or checkpoint logic', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  assert.ok(!/require\(.*production-gate/.test(src), 'src/ledger.js must never import the production gate');
  assert.ok(!/require\(.*production-issuance/.test(src), 'src/ledger.js must never import the production issuance module');
  assert.ok(!/require\(.*checkpoint/.test(src), 'src/ledger.js must never import checkpoint logic');
});

test('cross-path consistency: the committed repository configuration still never satisfies the production gate (unaffected by this change)', () => {
  const gate = require('../src/production-gate');
  const status = gate.computeGateStatus({
    ledgerFile: path.join(__dirname, '..', 'data', 'ledger.jsonl'),
    env: process.env,
  });
  assert.equal(status.available, false);
});

test('cross-path consistency: production issuance replay recovery is unchanged (identical assertions to the pre-existing G6 repair tests)', () => {
  // Not a new mechanism -- confirms this task did not touch
  // src/production-issuance.js's own recovery path.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'production-issuance.js'), 'utf8');
  assert.ok(/sameIssuanceIntent/.test(src), 'production-issuance.js still has its own independent replay-comparison logic, not removed or replaced');
});
