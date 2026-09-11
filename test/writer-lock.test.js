'use strict';

/**
 * §19/§20/§26 of production-hardening Phase 1 — single-authoritative-writer
 * model. spec/single-writer-model.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { acquireWriterLock, WriterLockedError, isProcessAlive } = require('../src/writer-lock');
const { Ledger } = require('../src/ledger');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-lock-'));
  return path.join(dir, 'ledger.jsonl');
}

test('acquire then release round-trips; the lock file is removed on release', () => {
  const file = tmpLedgerFile();
  const lock = acquireWriterLock(file);
  assert.ok(fs.existsSync(lock.path));
  lock.release();
  assert.ok(!fs.existsSync(lock.path));
});

test('a second acquisition by a LIVE holder fails closed (no merge, no best-effort write)', () => {
  const file = tmpLedgerFile();
  const first = acquireWriterLock(file);
  assert.throws(
    () => acquireWriterLock(file, { retries: 2, retryDelayMs: 1 }),
    (e) => e instanceof WriterLockedError && e.code === 'writer-locked' && e.holder.pid === process.pid
  );
  first.release();
  // now it succeeds
  const second = acquireWriterLock(file);
  second.release();
});

test('a STALE lock (dead pid) is reclaimed, reported, and never touches canonical ledger bytes', () => {
  const file = tmpLedgerFile();
  fs.writeFileSync(file + '.lock', JSON.stringify({ pid: 999999, host: 'nowhere', acquired_at: '2000-01-01T00:00:00Z' }));
  assert.equal(isProcessAlive(999999), false, 'pid 999999 should not be a real running process in this environment');
  const lock = acquireWriterLock(file);
  assert.equal(lock.reclaimed, true);
  assert.equal(lock.staleHolder.pid, 999999);
  lock.release();
});

test('§17/§18 the writer lock protects Ledger.append against overlapping in-process critical sections', () => {
  const file = tmpLedgerFile();
  const l = new Ledger(file).load();
  const { tii } = l.issueTII({ recorder: { id: 't', kind: 'person' } });
  for (let i = 0; i < 50; i++) l.append({ tii, event_type: 'note.added', recorder: { id: 't', kind: 'person' }, content: { i } });
  const seqs = l.events.map((e) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i), 'seq is dense and monotonic');
  assert.equal(l.verify().ok, true);
  assert.ok(!fs.existsSync(file + '.lock'), 'lock is always released');
});

test('§20/§26 CONCURRENCY REGRESSION — multiple OS processes: exactly one writer proceeds at a time; ledger never corrupts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-lock-mp-'));
  const file = path.join(dir, 'ledger.jsonl');
  const seed = new Ledger(file).load();
  const { tii } = seed.issueTII({ recorder: { id: 'seed', kind: 'mechanism' } });

  const writer = path.join(dir, 'writer.js');
  fs.writeFileSync(
    writer,
    `
    const { Ledger } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'ledger'))});
    const l = new Ledger(${JSON.stringify(file)}).load();
    let ok = 0, refused = 0;
    for (let i = 0; i < 10; i++) {
      try {
        l.append({ tii: ${JSON.stringify(tii)}, event_type: 'note.added',
          recorder: { id: process.argv[2], kind: 'mechanism' }, content: { w: process.argv[2], i } });
        ok++;
      } catch (e) {
        if (e.code === 'writer-locked') refused++; else throw e;
      }
    }
    process.stdout.write(JSON.stringify({ ok, refused }));
    `
  );

  const { spawn } = require('node:child_process');
  const N = 12;
  const outputs = await Promise.all(
    Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [writer, 'w' + i]);
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('writer exited ' + code + '\n' + err))));
    }))
  );
  const totals = outputs.map((o) => JSON.parse(o));
  const totalOk = totals.reduce((a, t) => a + t.ok, 0);
  const totalRefused = totals.reduce((a, t) => a + t.refused, 0);

  const reloaded = new Ledger(file).load();
  const v = reloaded.verify();
  const seqs = reloaded.events.map((e) => e.seq);

  assert.equal(v.ok, true, 'the ledger remains internally valid: ' + JSON.stringify(v.problems));
  assert.equal(new Set(seqs).size, seqs.length, 'no duplicate seq numbers');
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seq is monotonic (append order == seq order)');
  assert.equal(reloaded.events.length, 1 + totalOk, 'ledger event count matches exactly the writes that reported success');
  assert.equal(totalOk + totalRefused, N * 10, 'every attempt either succeeded or was explicitly refused — none silently vanished or corrupted');
  assert.ok(!fs.existsSync(file + '.lock'), 'no lock left behind');
});
