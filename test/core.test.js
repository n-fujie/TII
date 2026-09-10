'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const { project } = require('../src/projection');
const { newTII, isWellFormedTII, ALPHABET } = require('../src/id');
const exporters = require('../src/export');
const { freshLedger, withTII, snapshot } = require('./helpers');

test('identifier is opaque, well-formed, and collision-free at scale', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newTII((c) => seen.has(c));
    assert.ok(isWellFormedTII(id), `well formed: ${id}`);
    assert.match(id.slice(4), new RegExp(`^[${ALPHABET}]+$`));
    assert.equal(id.length, 4 + 12);
    assert.ok(!seen.has(id));
    seen.add(id);
  }
});

test('issuing a TII: only guaranteed meaning is "tracking started here"', () => {
  const ledger = freshLedger();
  const { tii, event } = ledger.issueTII({ recorder: 'admin' });
  assert.ok(isWellFormedTII(tii));
  assert.equal(event.event_type, 'tii.issued');
  assert.equal(event.content.identifier_status, 'test'); // 要件28
  assert.equal(event.seq, 0);
  assert.equal(event.prev_hash, '0'.repeat(64));
  // core has NO required state/transition/ignition/address/domain/owner/series field
  for (const forbidden of ['state', 'transition', 'ignition', 'address', 'domain', 'owner', 'series', 'boundary']) {
    assert.ok(!(forbidden in event), `core event must not carry required field "${forbidden}"`);
  }
});

test('append rejects events for an unknown TII', () => {
  const ledger = freshLedger();
  assert.throws(() => ledger.append({ tii: 'tii:zzzzzzzzzzzz', event_type: 'note.added', recorder: 'x' }));
});

test('event_type is an open vocabulary — unknown types are stored verbatim', () => {
  const { ledger, tii } = withTII();
  const ev = ledger.append({
    tii,
    event_type: 'some.future.event.type.not.in.registry',
    recorder: 'x',
    content: { anything: true },
  });
  assert.equal(ev.event_type, 'some.future.event.type.not.in.registry');
  assert.deepEqual(ledger.getEvent(ev.event_id).content, { anything: true });
});

test('hash chain verifies across many appends', () => {
  const { ledger, tii } = withTII();
  for (let i = 0; i < 25; i++) {
    ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { i } });
  }
  const v = ledger.verify();
  assert.ok(v.ok, JSON.stringify(v.problems));
  assert.equal(v.event_count, 26);
});

test('tampering with a stored line is detected on reload', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { note: 'original' } });
  const raw = fs.readFileSync(ledger.file, 'utf8').split('\n').filter(Boolean);
  raw[1] = raw[1].replace('original', 'SECRETLY CHANGED');
  fs.writeFileSync(ledger.file, raw.join('\n') + '\n');

  const reloaded = new Ledger(ledger.file).load();
  const v = reloaded.verify();
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /hash mismatch/.test(p.issue)));
});

test('deleting a line is detected on reload', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'a', recorder: 'x' });
  ledger.append({ tii, event_type: 'b', recorder: 'x' });
  const raw = fs.readFileSync(ledger.file, 'utf8').split('\n').filter(Boolean);
  raw.splice(1, 1); // drop the middle event
  fs.writeFileSync(ledger.file, raw.join('\n') + '\n');
  const v = new Ledger(ledger.file).load().verify();
  assert.equal(v.ok, false);
});

test('corrections are additive: the superseded event is never rewritten', () => {
  const { ledger, tii } = withTII();
  const wrong = ledger.append({
    tii,
    event_type: 'record.added',
    recorder: 'x',
    content: { module: 'note', ref: 'n1', title: 'Typo Titel' },
  });
  const wrongSnapshot = JSON.parse(JSON.stringify(ledger.getEvent(wrong.event_id)));

  const fix = ledger.append({
    tii,
    event_type: 'record.corrected',
    recorder: 'x',
    supersedes: wrong.event_id,
    content: { module: 'note', ref: 'n1', title: 'Correct Title' },
  });

  // old event still there, unchanged
  assert.deepEqual(ledger.getEvent(wrong.event_id), wrongSnapshot);

  const p = project(ledger.forTII(tii));
  // history still contains the wrong event
  assert.ok(p.events.some((e) => e.event_id === wrong.event_id));
  assert.deepEqual(p.superseded_event_ids, [wrong.event_id]);
  // current reading is the correction
  const bucket = p.modules.note.find((b) => b.ref === 'n1');
  assert.equal(bucket.current.content.title, 'Correct Title');
  assert.equal(fix.supersedes, wrong.event_id);
});

test('projection does not invent a "current state" when there are no module records', () => {
  const { ledger, tii } = withTII();
  const p = project(ledger.forTII(tii));
  assert.deepEqual(p.modules, {});
  assert.equal(p.lifecycle_state, 'active');
});

test('evidence, judgement and system display are separated', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'evidence.referenced', recorder: 'observerA', content: { module: 'note', ref: 'e' }, basis: ['file://evidence-A'] });
  ledger.append({ tii, event_type: 'ignition.described', recorder: 'X', content: { module: 'ignition', ref: 'ig1', act: 'introduce', what: 'rule R became operative' }, basis: ['file://evidence-A'] });
  ledger.append({ tii, event_type: 'ignition.disputed', recorder: 'Y', content: { module: 'ignition', ref: 'ig1', act: 'dispute', reason: 'conditions not met' } });
  ledger.append({ tii, event_type: 'ignition.withdrawn', recorder: 'X', content: { module: 'ignition', ref: 'ig1', act: 'withdraw', reason: 'judgement retracted' } });

  const p = project(ledger.forTII(tii));
  const ig = p.modules.ignition.find((b) => b.ref === 'ig1');
  assert.equal(ig.disputed, true);
  assert.equal(ig.withdrawn, true);
  assert.equal(ig.current, null); // no auto ontological conclusion
  assert.equal(ig.records.length, 3);
  assert.ok(p.disputes.length >= 1);
});

test('full ledger round-trips through JSONL with identical head hash and TII strings', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'address.described', recorder: 'x', content: { module: 'address', ref: 'a1', act: 'introduce', kind: 'public-location', value: 'https://example.org/x' } });
  const jsonl = exporters.toJSONL(ledger);

  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tii-rt-'));
  const file = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(file, jsonl);
  const rebuilt = new Ledger(file).load();

  assert.equal(rebuilt.lastHash, ledger.lastHash);
  assert.deepEqual(rebuilt.listTIIs(), ledger.listTIIs());
  assert.ok(rebuilt.verify().ok);
  assert.deepEqual(rebuilt.events, ledger.events);
});

test('static site can be rebuilt from the ledger alone (no server, no DB)', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { module: 'note', ref: 'n', text: 'hello' } });
  const out = path.join(ledger._dir, 'dist');
  const result = exporters.buildStaticSite(ledger, out);
  assert.equal(result.tii_count, 1);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'ledger.jsonl')));
  assert.ok(fs.existsSync(path.join(out, 'spec.html')));
  const files = fs.readdirSync(path.join(out, 'tii'));
  assert.ok(files.some((f) => f.endsWith('.html')));
  assert.ok(files.some((f) => f.endsWith('.json')));
});

test('CSV export contains one row per event plus header', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { a: 1 } });
  const csv = exporters.toCSV(ledger).trim().split('\n');
  assert.equal(csv.length, 1 + ledger.events.length);
  assert.ok(csv[0].startsWith('seq,event_id,tii'));
});
