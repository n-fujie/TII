'use strict';

/**
 * §21-§24, §27 of production-hardening Phase 1 — crash-safe append and
 * explicit recovery. spec/crash-recovery.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const { RecoveryRequiredError, inspect } = require('../src/recovery');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-crash-'));
  return path.join(dir, 'ledger.jsonl');
}
const R = (id) => ({ id, kind: 'person' });

test('§27 a truncated final line: load() reports recovery-required instead of throwing; the valid prefix is untouched and readable', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  const { tii } = l.issueTII({ recorder: R('t') });
  const good = l.append({ tii, event_type: 'note.added', recorder: R('t'), content: { i: 1 } });
  const beforeBytes = fs.readFileSync(file);

  fs.appendFileSync(file, '{"event_id":"evt_partial","seq":2,"recorded'); // simulates a crash mid fs.writeSync

  const reloaded = new Ledger(file).load();
  assert.equal(reloaded.recovery.required, true);
  assert.equal(reloaded.recovery.malformedTail.line_number, 3);
  assert.equal(reloaded.events.length, 2);
  assert.equal(reloaded.getEvent(good.event_id).hash, good.hash);
  // the file on disk was NOT rewritten by loading
  assert.ok(fs.readFileSync(file).slice(0, beforeBytes.length).equals(beforeBytes));

  assert.throws(() => reloaded.append({ tii, event_type: 'x', recorder: R('t') }), (e) => e instanceof RecoveryRequiredError && e.code === 'recovery-required');
});

test('§22/§23 an orphaned write-ahead journal (crash before the canonical write): detected, ledger unaffected, write refused until recovery', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  const { tii } = l.issueTII({ recorder: R('t') });
  const beforeHead = l.verify().head_hash;

  // simulate a crash between "journal fsynced" and "canonical append" —
  // the journal names an event that was NEVER written to the ledger.
  const orphan = { event_id: 'evt_neverapplied', tii, seq: 1, recorded_at: '2026-01-01T00:00:00Z', ledger_written_at: '2026-01-01T00:00:00Z', recorder: R('t'), event_type: 'note.added', content: {}, basis: [], external_refs: [], prev_event_for_target: null, prev_hash: beforeHead, hash: 'deadbeef'.repeat(8) };
  fs.writeFileSync(file + '.journal', JSON.stringify(orphan) + '\n');

  const reloaded = new Ledger(file).load();
  assert.equal(reloaded.recovery.journalObservedAtLoad, true);
  assert.equal(reloaded.events.length, 1, 'the ledger itself is untouched — the orphaned event was never applied');

  const report = inspect(file);
  assert.equal(report.recovery_required, true);
  assert.equal(report.journal.already_committed, false, 'never written to the canonical ledger');
  assert.equal(report.journal.event.event_id, 'evt_neverapplied');

  assert.throws(() => reloaded.append({ tii, event_type: 'x', recorder: R('t') }));
});

test('§22/§23 an orphaned journal whose event IS already in the ledger (crash after the write, before journal cleanup) is distinguishable as already_committed', () => {
  const file = tmpFile();
  const l = new Ledger(file).load();
  const { tii } = l.issueTII({ recorder: R('t') });
  const ev = l.append({ tii, event_type: 'note.added', recorder: R('t'), content: {} });
  // re-write the journal to simulate "crash happened just before unlink" —
  // the event IS the current ledger tail.
  fs.writeFileSync(file + '.journal', JSON.stringify(ev) + '\n');

  const report = inspect(file);
  assert.equal(report.journal.already_committed, true);
  assert.equal(report.journal.event.event_id, ev.event_id);
});

test('§24 explicit recovery: `tii recover truncate-tail` preserves the valid prefix, backs up the damaged file, and states exactly what was removed', () => {
  const { execFileSync } = require('node:child_process');
  const bin = path.join(__dirname, '..', 'bin', 'tii.js');
  const file = tmpFile();
  const env = { ...process.env, TII_LEDGER: file };
  execFileSync(process.execPath, [bin, 'issue', '--recorder', 't'], { env });
  const before = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, '{"event_id":"evt_bad","seq":');

  const inspectOut = JSON.parse(execFileSync(process.execPath, [bin, 'recover', 'inspect'], { env }).toString());
  assert.equal(inspectOut.recovery_required, true);

  const result = JSON.parse(execFileSync(process.execPath, [bin, 'recover', 'truncate-tail'], { env }).toString());
  assert.ok(result.backup_file && fs.existsSync(result.backup_file), 'a backup of the damaged file was written');
  assert.equal(fs.readFileSync(result.backup_file, 'utf8').includes('evt_bad'), true, 'the backup preserves the damaged bytes');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the repaired ledger equals exactly the valid prefix — byte for byte');
  assert.deepEqual(result.removed_bytes > 0, true);

  const reloaded = new Ledger(file).load();
  assert.equal(reloaded.recovery.required, false);
  assert.equal(reloaded.verify().ok, true);
  // now writable again
  reloaded.append({ tii: reloaded.listTIIs()[0], event_type: 'note.added', recorder: R('t') });
  assert.equal(reloaded.verify().ok, true);
});

test('§22 explicit recovery: `tii recover commit-journal` safely completes a never-applied journaled event; `discard-journal` removes without applying', () => {
  const { execFileSync } = require('node:child_process');
  const bin = path.join(__dirname, '..', 'bin', 'tii.js');

  // case A: commit-journal completes a genuinely pending (never-applied) event
  {
    const file = tmpFile();
    const env = { ...process.env, TII_LEDGER: file };
    execFileSync(process.execPath, [bin, 'issue', '--recorder', 't'], { env });
    const l = new Ledger(file).load();
    const tii = l.listTIIs()[0];
    const pending = { event_id: 'evt_pending1', tii, seq: 1, recorded_at: '2026-01-01T00:00:00Z', ledger_written_at: '2026-01-01T00:00:00Z', recorder: R('t'), event_type: 'note.added', content: { via: 'journal' }, basis: [], external_refs: [], prev_event_for_target: l.events[0].event_id, prev_hash: l.lastHash };
    const { canonicalize } = require('../src/canonical');
    const { sha256 } = require('../src/hash');
    pending.hash = sha256(pending.prev_hash + canonicalize(pending));
    fs.writeFileSync(file + '.journal', JSON.stringify(pending) + '\n');

    execFileSync(process.execPath, [bin, 'recover', 'commit-journal'], { env });
    const after = new Ledger(file).load();
    assert.equal(after.recovery.required, false);
    assert.equal(after.getEvent('evt_pending1').content.via, 'journal');
    assert.equal(after.verify().ok, true);
    assert.ok(!fs.existsSync(file + '.journal'));
  }

  // case B: discard-journal removes an orphaned journal WITHOUT applying it
  {
    const file = tmpFile();
    const env = { ...process.env, TII_LEDGER: file };
    execFileSync(process.execPath, [bin, 'issue', '--recorder', 't'], { env });
    const l = new Ledger(file).load();
    const eventsBefore = l.events.length;
    fs.writeFileSync(file + '.journal', JSON.stringify({ event_id: 'evt_discard_me', tii: l.listTIIs()[0], seq: 99, recorded_at: 'x', ledger_written_at: 'x', recorder: R('t'), event_type: 'y', content: {}, basis: [], external_refs: [], prev_event_for_target: null, prev_hash: 'x', hash: 'x' }) + '\n');

    execFileSync(process.execPath, [bin, 'recover', 'discard-journal'], { env });
    const after = new Ledger(file).load();
    assert.equal(after.recovery.required, false);
    assert.equal(after.events.length, eventsBefore, 'the pending event was NOT applied');
    assert.equal(after.getEvent('evt_discard_me'), null);
  }
});
