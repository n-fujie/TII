'use strict';

/**
 * Root-cause regression for the intermittent failure discovered in
 * test/production-gate.test.js's "G6 repair — CONCURRENCY" test.
 *
 * ROOT CAUSE (confirmed by instrumented reproduction under real OS-level
 * process concurrency, not guessed): Ledger.load() used to read the ledger
 * file's CONTENT via fs.readFileSync(), then separately query its SIZE via
 * an independent fs.statSync() call, and store that size as
 * `_lastKnownSize` — the value `_resyncIfChanged()` later trusts as proof
 * "our in-memory state is current if the size still matches". Those two
 * syscalls are not atomic with each other. If a concurrent writer's
 * append() (itself correctly fsynced under its OWN exclusive writer-lock
 * critical section) completed in the window between this instance's
 * readFileSync and its OWN LATER statSync, the resulting instance ended up
 * with `_lastKnownSize` matching the NEW (post-write) file size while
 * `events` / `_idempotency` / `_issuedTII` still reflected the OLD
 * (pre-write) content it had actually parsed. Because `_resyncIfChanged()`
 * skips reloading whenever the size already matches, that mismatch was
 * never self-corrected — the instance could believe an idempotency_key had
 * never been used, forever, even though another process had already
 * durably recorded an event for it.
 *
 * Observed real-world effect (reproduced via real spawned child processes
 * under artificial system load — see the investigation's harness scripts):
 * two concurrent callers of issueProductionTII() with the SAME
 * idempotency_key both resolved "not yet used" and both appended, producing
 * two tii.issued events at seq 0 and a broken hash chain
 * (ledger.verify().ok === false). This is a violation of the idempotency
 * invariant "at most one issuance succeeds for a given idempotency key" and
 * the append-only invariant "ledger append is atomic / seq is unique".
 *
 * THE FIX (src/ledger.js load()): _lastKnownSize is now derived from the
 * byte length of the SAME buffer that was actually read and parsed — never
 * from a separate, independently-timed syscall — so the two values cannot
 * disagree regardless of when a concurrent write lands relative to this
 * read.
 *
 * The tests below inject the exact race DETERMINISTICALLY (a concurrent
 * write is forced to land inside a single load() call's read, via a
 * monkeypatch of fs.readFileSync scoped to one call and always restored in
 * `finally`) rather than relying on OS scheduling luck, so this suite does
 * not need artificial timing or system load to prove the invariant. A
 * separate, real-process, non-deterministic reproduction of the original
 * symptom is also included, skipped by default (opt-in via
 * TII_RUN_SLOW_CONCURRENCY_REPRO=true) since it depends on genuine OS
 * scheduling pressure and is not suitable as a normal fast/deterministic
 * regression.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const { issueProductionTII } = require('../src/production-issuance');
const checkpointStore = require('../src/checkpoint-store');
const { generateKeypair } = require('../src/checkpoint');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ledger-race-'));
  return path.join(dir, 'ledger.jsonl');
}
const R = (id) => ({ id, kind: 'person' });

/** Minimal gate-satisfied fixture, mirroring test/production-gate.test.js's
 * own allSatisfiedFor() helper (not imported directly since that file
 * doesn't export it) -- a real checkpoint against a disposable directory,
 * never the repo's own checkpoints/. */
function gateSatisfiedEnv(ledger) {
  const kp = generateKeypair();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ledger-race-key-'));
  const keyFile = path.join(keyDir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  const checkpointDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ledger-race-ckpt-')), 'checkpoints');
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

/**
 * Deterministically forces the exact race: while `victim`'s load() is in
 * the middle of its own fs.readFileSync() call, `concurrentWrite` runs and
 * completes (simulating another process's fsynced append landing in that
 * window), and THEN the ORIGINAL (pre-write) buffer is what `victim`'s
 * readFileSync call still returns — exactly modeling "our read captured
 * the old content, but a concurrent writer finished before we finished
 * inspecting the file". Patches fs.readFileSync for exactly ONE call
 * (matching `forFile`), always restored in `finally`.
 */
function withInjectedConcurrentWriteDuringRead(forFile, concurrentWrite, fn) {
  const originalReadFileSync = fs.readFileSync;
  let patched = false;
  fs.readFileSync = function (file, ...rest) {
    if (!patched && file === forFile) {
      patched = true; // only the first matching call is intercepted
      const preWriteContent = originalReadFileSync(file, ...rest);
      concurrentWrite(); // the "other process" finishes its append right now
      return preWriteContent; // our own read still only saw the OLD content
    }
    return originalReadFileSync(file, ...rest);
  };
  try {
    return fn();
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}

test('regression: load() never lets _lastKnownSize disagree with what was actually parsed, even when a concurrent write completes mid-read', () => {
  const file = tmpFile();
  const seed = new Ledger(file).load();
  seed.issueTII({ recorder: R('seed') }); // one pre-existing event, non-empty baseline
  const sizeBeforeRace = fs.statSync(file).size;

  const victim = new Ledger(file); // NOT loaded yet
  withInjectedConcurrentWriteDuringRead(
    file,
    () => {
      // a fully independent Ledger instance, modeling a concurrent process,
      // performs a real, complete, fsynced append while victim's read is
      // "in flight"
      const concurrentWriter = new Ledger(file).load();
      concurrentWriter.issueTII({ recorder: R('concurrent') });
    },
    () => victim.load()
  );

  // The core invariant: whatever load() actually parsed into `events` is
  // EXACTLY what _lastKnownSize claims to be current for. If this ever
  // regresses (e.g. a future edit reintroduces a separate statSync() call),
  // this assertion is what would catch it: _lastKnownSize would reflect the
  // concurrent writer's larger post-write size while `events` still only
  // has the pre-write content — precisely the corrupt state that produced
  // the real failure.
  assert.equal(victim.events.length, 1, 'this load() call captured only the pre-existing seed event (by construction of the injected race)');
  assert.equal(victim._lastKnownSize, sizeBeforeRace, '_lastKnownSize must equal the byte length of exactly what was parsed (the pre-race size), never the concurrent writer\'s larger post-write size');

  // And critically: _resyncIfChanged() must now correctly detect that the
  // REAL current file is larger than what this instance knows about, and
  // catch up — this is the actual behavior that prevents the double-issuance.
  assert.equal(victim.tiiExists(seed.events[0].tii), true);
  const concurrentTii = new Ledger(file).load().events[1].tii;
  assert.equal(victim.tiiExists(concurrentTii), false, 'sanity: victim genuinely has not seen the concurrent event yet');

  // Now reproduce the ACTUAL failure shape from test/production-gate.test.js
  // via issueProductionTII() specifically (not the generic Ledger.issueTII()
  // used above just to seed a baseline event) -- issueProductionTII() is the
  // exact function the originally-failing test calls, and it has the
  // specific compensating logic (src/production-issuance.js's catch block
  // around append(), re-checking findByIdempotencyKey + sameIssuanceIntent)
  // that converts append()'s "already used for a different operation" throw
  // into a correct replay when the content actually matches, even though
  // the candidate tii differs. (NOTE: Ledger.issueTII() -- the generic/test
  // path -- has no equivalent recovery step; see this file's final comment
  // for that separate, adjacent finding, deliberately not fixed here.)
  const file2 = tmpFile();
  const seed2 = new Ledger(file2).load();
  seed2.issueTII({ recorder: R('seed') }); // the ledger file must actually exist on disk before the race, or load() takes the "file doesn't exist" branch and never calls readFileSync at all
  const { env, checkpointDir } = gateSatisfiedEnv(seed2);
  const victim2 = new Ledger(file2);
  const key = 'RACE-TEST-KEY';
  let winnerTii;
  withInjectedConcurrentWriteDuringRead(
    file2,
    () => {
      const winner = new Ledger(file2).load();
      const r = issueProductionTII(winner, { env, checkpointDir, recorder: R('concurrent'), content: { note: 'x' }, idempotency_key: key });
      winnerTii = r.tii;
    },
    () => victim2.load()
  );
  assert.equal(victim2._idempotency.has(key), false, 'sanity: the race left victim2 unaware of the key, exactly as in the real bug');

  const result = issueProductionTII(victim2, { env, checkpointDir, recorder: R('victim'), content: { note: 'x' }, idempotency_key: key });
  assert.equal(result.tii, winnerTii, 'append()\'s own authoritative resync (inside the writer lock) must catch the race THIS TIME, converging on the winner\'s tii rather than minting a second one');
  assert.equal(result.idempotent_replay, true);

  const final = new Ledger(file2).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 1, 'exactly one event exists for this idempotency key — no duplicate');
  assert.equal(final.verify().ok, true, 'hash chain is intact — no seq collision');
});

test('regression: the race, if left uncaught by load(), would have produced two seq-0-colliding events (characterizing WITHOUT the fix, via a locally reverted load())', () => {
  // This test documents and directly demonstrates the ORIGINAL defect by
  // reverting ONLY the load() method (monkeypatched on the prototype for
  // the duration of this test, restored in `finally`) to the pre-fix
  // behavior (content read, THEN a separate, independently-timed stat()
  // call) — proving the OLD code really did corrupt state under this exact
  // injected interleaving, which is what justifies the fix rather than a
  // speculative guess.
  const { parseLedgerTolerant, journalPath } = require('../src/recovery');
  const originalLoad = Ledger.prototype.load;
  Ledger.prototype.load = function () {
    this.events = [];
    this._byEventId.clear();
    this._issuedTII.clear();
    this._idempotency.clear();
    this.recovery = { required: false, malformedTail: null, journalObservedAtLoad: false };
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8'); // (1) read content
      const { events, malformed } = parseLedgerTolerant(raw);
      for (const ev of events) this._index(ev);
      if (malformed) {
        this.recovery.required = true;
        this.recovery.malformedTail = malformed;
      }
    }
    this.recovery.journalObservedAtLoad = fs.existsSync(journalPath(this.file));
    this._lastKnownSize = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0; // (2) SEPARATE, later stat() -- the pre-fix bug
    return this;
  };

  try {
    const file = tmpFile();
    const seed = new Ledger(file).load();
    seed.issueTII({ recorder: R('seed') });

    const key = 'PRE-FIX-DEMO-KEY';
    const victim = new Ledger(file);
    withInjectedConcurrentWriteDuringRead(
      file,
      () => {
        const winner = new Ledger(file).load();
        winner.issueTII({ recorder: R('concurrent'), content: { note: 'x' }, idempotency_key: key });
      },
      () => victim.load()
    );

    // With the PRE-FIX load(), _lastKnownSize already matches the current
    // (post-concurrent-write) size, so _resyncIfChanged() thinks nothing
    // changed -- even though `events`/`_idempotency` never saw the
    // concurrent writer's event. This reproduces the exact corrupt state.
    assert.equal(victim._idempotency.has(key), false, 'pre-fix: unaware of the concurrent key (same as post-fix so far)');
    const currentDiskSize = fs.statSync(file).size;
    assert.equal(victim._lastKnownSize, currentDiskSize, 'pre-fix DEFECT: _lastKnownSize already matches the CURRENT (post-write) size despite events being stale -- resync will now never trigger');

    const result = victim.issueTII({ recorder: R('victim'), content: { note: 'x' }, idempotency_key: key });
    assert.equal(result.idempotent_replay, undefined, 'pre-fix DEFECT: victim believes this is a brand-new issuance, not a replay');

    const final = new Ledger(file).load();
    assert.equal(final.events.filter((e) => e.idempotency_key === key).length, 2, 'pre-fix DEFECT: TWO events now exist for the same idempotency key');
    assert.equal(final.verify().ok, false, 'pre-fix DEFECT: the hash chain is broken (duplicate seq)');
  } finally {
    Ledger.prototype.load = originalLoad;
  }
});

/**
 * Real-process, non-deterministic confirmation of the fix under genuine OS
 * scheduling pressure (the same shape of reproduction used during the
 * investigation). Opt-in only (TII_RUN_SLOW_CONCURRENCY_REPRO=true) because
 * its failure-inducing conditions depend on real system load and it is not
 * a fast, deterministic test — the two tests above are the actual
 * regression guards that run by default.
 */
test('optional slow repro: many real concurrent processes converge on one event under load', { skip: process.env.TII_RUN_SLOW_CONCURRENCY_REPRO !== 'true' }, async () => {
  const { spawn } = require('node:child_process');
  const file = tmpFile();
  const seed = new Ledger(file).load();
  seed.issueTII({ recorder: R('seed') });

  const workerFile = path.join(path.dirname(file), 'worker.js');
  fs.writeFileSync(
    workerFile,
    `
    const { Ledger } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'ledger'))});
    const l = new Ledger(${JSON.stringify(file)}).load();
    const r = l.issueTII({ recorder: { id: 'w', kind: 'mechanism' }, content: { note: 'x' }, idempotency_key: 'SLOW-REPRO-KEY' });
    process.stdout.write(JSON.stringify({ tii: r.tii, replay: !!r.idempotent_replay }));
    `
  );
  const N = 16;
  const outputs = await Promise.all(
    Array.from({ length: N }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerFile]);
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('worker exited ' + code))));
    }))
  );
  const results = outputs.map((o) => JSON.parse(o));
  const distinctTiis = new Set(results.map((r) => r.tii));
  assert.equal(distinctTiis.size, 1);
  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.idempotency_key === 'SLOW-REPRO-KEY').length, 1);
  assert.equal(final.verify().ok, true);
});
