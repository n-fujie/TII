'use strict';

/**
 * Reproducible subset of the capability-boundary audit
 * (spec/capability-boundary-audit.md). Deterministic + fast only — the scale,
 * multi-process concurrency, and large-payload measurements live in
 * spec/audit/*.js and are not run here.
 *
 * These tests DOCUMENT the boundary, including the known negatives. A test that
 * asserts a limitation still exists is intentional — if one starts failing
 * because the limitation was fixed, update the audit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');
const { project, displayContent } = require('../src/projection');
const { canonicalize } = require('../src/canonical');
const { sha256 } = require('../src/hash');
const exporters = require('../src/export');
const views = require('../src/views');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-capreg-'));
  return new Ledger(path.join(dir, 'l.jsonl')).load();
}
const R = (id) => ({ id, kind: 'person' });

/* ---------------------------------------------------------- CAN DO --------- */

test('§4/§5 issuance requires only {recorder}; minimal TII has empty modules and no optional category', () => {
  const l = fresh();
  assert.throws(() => l.issueTII({}), /recorder/);
  const { tii, event } = l.issueTII({ recorder: R('t') });
  assert.equal(event.content.identifier_status, 'test');
  const p = project(l.forTII(tii));
  assert.deepEqual(p.modules, {});
  for (const k of ['state', 'transition', 'ignition', 'address', 'domain', 'boundary', 'lineage', 'owner', 'object']) {
    assert.ok(!(k in event), `issued event must not carry "${k}"`);
    assert.ok(!(k in p), `projection must not carry "${k}"`);
  }
});

test('§6 unknown event_type / module / act survive export → re-import → projection → render → verify', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const ev = l.append({ tii, event_type: 'x.never.seen.q', recorder: R('t'), content: { module: 'mod-never-seen-q', ref: 'r', act: 'act-never-seen-q', k: [1, 'two'] } });
  const re = new Ledger(path.join(path.dirname(l.file), 're.jsonl'));
  fs.writeFileSync(re.file, exporters.toJSONL(l));
  re.load();
  const p = project(re.forTII(tii));
  assert.equal(re.getEvent(ev.event_id).content.act, 'act-never-seen-q');
  assert.ok(p.modules['mod-never-seen-q']);
  assert.match(views.resolutionPage({ lang: 'en', p }), /act-never-seen-q/);
  assert.ok(re.verify().ok);
});

test('§7 supersede-not-overwrite; withdraw → no current interpretation', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const a = l.append({ tii, event_type: 'record.added', recorder: R('x'), content: { module: 'c', ref: 'c', act: 'introduce', v: 'A' } });
  const snap = JSON.stringify(l.getEvent(a.event_id));
  l.append({ tii, event_type: 'record.corrected', recorder: R('x'), supersedes: a.event_id, content: { module: 'c', ref: 'c', act: 'replace', v: 'B' } });
  l.append({ tii, event_type: 'c.withdrawn', recorder: R('x'), content: { module: 'c', ref: 'c', act: 'withdraw' } });
  assert.equal(JSON.stringify(l.getEvent(a.event_id)), snap, 'A unchanged');
  const p = project(l.forTII(tii));
  assert.ok(p.superseded_event_ids.includes(a.event_id));
  assert.equal(p.modules.c[0].current, null, 'withdraw → no current interpretation');
  assert.equal(p.modules.c[0].records.length, 3, 'all 3 events retained in the bucket history');
});

test('§13 hash change ≠ identity change; equal hashes do not merge two TIIs', () => {
  const l = fresh();
  const A = l.issueTII({ recorder: R('t') }).tii;
  l.append({ tii: A, event_type: 'content.hash.recorded', recorder: R('x'), content: { module: 'content', ref: 'f', algo: 'sha256', value: 'a'.repeat(64) } });
  l.append({ tii: A, event_type: 'content.hash.recorded', recorder: R('x'), content: { module: 'content', ref: 'f', act: 'replace', algo: 'sha256', value: 'b'.repeat(64) } });
  assert.equal(project(l.forTII(A)).tii, A);
  assert.equal(project(l.forTII(A)).modules.content[0].records.length, 2);
  const B = l.issueTII({ recorder: R('t') }).tii;
  const C = l.issueTII({ recorder: R('t') }).tii;
  for (const t of [B, C]) l.append({ tii: t, event_type: 'content.hash.recorded', recorder: R('x'), content: { module: 'content', ref: 'f', algo: 'sha256', value: 'c'.repeat(64) } });
  assert.notEqual(B, C);
  assert.equal(l.listTIIs().length, 3);
});

test('§16 no owner field anywhere; overlapping/conflicting relations retained', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  for (const rt of ['stores', 'controls', 'may_modify', 'funds', 'signs']) {
    l.append({ tii, event_type: 'relation.asserted', recorder: R('x'), content: { module: 'relation', ref: rt, act: 'introduce', relation_type: rt, subject: 'actor-' + rt } });
  }
  const p = project(l.forTII(tii));
  assert.ok(!('owner' in p));
  assert.ok(!l.forTII(tii).some((e) => 'owner' in (e.content || {})));
  assert.equal(p.modules.relation.length, 5);
});

test('§18 localization: authored immutable, newest translation projected, static build does not mutate the ledger', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const src = l.append({ tii, event_type: 'note.added', recorder: R('jp'), content: { module: 'note', ref: 'n', description: '原文', language: 'ja' } });
  const loc = (lang, text) => l.append({ tii, event_type: 'localization.added', recorder: R('tr'), content: { module: 'localization', ref: src.event_id, source_event: src.event_id, target_language: lang, kind: 'literal', translated_content: { description: text } } });
  loc('en', 'v1'); loc('en', 'v2'); loc('fr', 'fr1');
  const before = exporters.toJSONL(l);
  const p = project(l.forTII(tii));
  const v = p.events.find((e) => e.event_id === src.event_id);
  assert.equal(displayContent(p, v, 'en').content.description, 'v2');
  assert.equal(displayContent(p, v, 'ja').content.description, '原文');
  assert.equal(displayContent(p, v, 'fr').content.description, 'fr1');
  assert.equal(l.getEvent(src.event_id).content.description, '原文');
  exporters.buildStaticSite(l, path.join(path.dirname(l.file), 'pub'));
  assert.equal(exporters.toJSONL(l), before, 'buildStaticSite left the ledger byte-identical');
});

test('§25 verify() detects localised tampering (edit, delete, reorder, hash edit)', () => {
  const build = () => { const l = fresh(); const { tii } = l.issueTII({ recorder: R('t') }); for (let i = 0; i < 4; i++) l.append({ tii, event_type: 'note.added', recorder: R('t'), content: { i } }); return l; };
  const mutate = (l, fn) => { const lines = fs.readFileSync(l.file, 'utf8').split('\n').filter(Boolean); fn(lines); fs.writeFileSync(l.file, lines.join('\n') + '\n'); return new Ledger(l.file).load().verify(); };
  assert.equal(mutate(build(), (L) => { L[2] = L[2].replace('"i":1', '"i":99'); }).ok, false);
  assert.equal(mutate(build(), (L) => { L.splice(2, 1); }).ok, false);
  assert.equal(mutate(build(), (L) => { const t = L[2]; L[2] = L[3]; L[3] = t; }).ok, false);
  assert.equal(mutate(build(), (L) => { const o = JSON.parse(L[3]); o.hash = 'f'.repeat(64); L[3] = JSON.stringify(o); }).ok, false);
});

test('§32 reconstruction from ledger.jsonl alone (zero deps)', () => {
  assert.deepEqual(require('../package.json').dependencies || {}, {}, 'zero npm dependencies');
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  l.append({ tii, event_type: 'note.added', recorder: R('t'), content: { module: 'note', ref: 'n', text: 'x' } });
  const head = l.verify().head_hash;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-recon-'));
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), exporters.toJSONL(l));
  const re = new Ledger(path.join(dir, 'ledger.jsonl')).load();
  assert.equal(re.verify().head_hash, head);
  assert.deepEqual(re.listTIIs(), l.listTIIs());
  exporters.buildStaticSite(re, path.join(dir, 'public'));
  assert.ok(fs.existsSync(path.join(dir, 'public', 'index.html')));
});

/* --------------------------------------------------- KNOWN NEGATIVES ------- */

test('§26 KNOWN NEGATIVE — verify() alone CANNOT detect a fully-recomputed forged chain', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  for (let i = 0; i < 5; i++) l.append({ tii, event_type: 'note.added', recorder: R('t'), content: { module: 'note', ref: 'n' + i, text: 'orig ' + i } });
  const legitHead = l.verify().head_hash;

  const events = fs.readFileSync(l.file, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  events[2].content = { module: 'note', ref: 'n1', text: 'FORGED' };
  events[2].recorder = { id: 'attacker', kind: 'person' };
  let prev = events[1].hash;
  for (let i = 2; i < events.length; i++) {
    events[i].prev_hash = prev;
    const { hash, ...body } = events[i];
    events[i].hash = sha256(events[i].prev_hash + canonicalize(body));
    prev = events[i].hash;
  }
  const forged = path.join(path.dirname(l.file), 'forged.jsonl');
  fs.writeFileSync(forged, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const fv = new Ledger(forged).load().verify();
  assert.equal(fv.ok, true, 'the forged chain passes verify()');
  assert.deepEqual(fv.problems, []);
  assert.notEqual(fv.head_hash, legitHead, 'the forged head differs — only an external checkpoint over legitHead would catch this');
});

test('§27 KNOWN NEGATIVE — a partial final line makes the whole ledger fail to load', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  l.append({ tii, event_type: 'note.added', recorder: R('t'), content: { i: 1 } });
  fs.appendFileSync(l.file, '{"event_id":"evt_partial","seq":2,"recorded');
  assert.throws(() => new Ledger(l.file).load(), /JSON/);
});

test('§27 KNOWN NEGATIVE — identical requests double-record (no idempotency)', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const body = { tii, event_type: 'note.added', recorder: R('t'), content: { module: 'note', ref: 'dup', text: 'same' } };
  const a = l.append({ ...body });
  const b = l.append({ ...body });
  assert.notEqual(a.event_id, b.event_id);
  assert.equal(l.forTII(tii).filter((e) => (e.content || {}).ref === 'dup').length, 2);
});

test('§40 KNOWN NEGATIVE — "restricted" content is published on every surface', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const secret = 'SECRET-audit-marker-9f3a';
  l.append({ tii, event_type: 'evidence.referenced', recorder: R('t'), content: { module: 'evidence', ref: 'e', description: secret, disclosure: 'restricted' } });
  const p = project(l.forTII(tii));
  assert.ok(exporters.toJSONL(l).includes(secret));
  assert.ok(exporters.toCSV(l).includes(secret));
  assert.ok(views.resolutionPage({ lang: 'en', p }).includes(secret));
  assert.ok(JSON.stringify(p).includes(secret));
});

test('§15 KNOWN LIMITATION — cyclic descriptive references are neither detected nor rejected', () => {
  const l = fresh();
  const { tii } = l.issueTII({ recorder: R('t') });
  const ev = l.append({ tii, event_type: 'transition.described', recorder: R('t'), content: { module: 'transition', ref: 'c', act: 'introduce', relation_kind: 'cyclic', from_ref: 'D', to_ref: 'A' } });
  assert.ok(ev.event_id, 'accepted with no cycle check');
  assert.ok(l.verify().ok);
});

test('§22/§24 candidate code is imported by nothing on the live path', () => {
  for (const f of ['id.js', 'ledger.js', 'server.js', 'export.js', 'projection.js', 'canonical.js', 'views.js', 'hash.js']) {
    assert.ok(!/candidate\//.test(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')), `src/${f}`);
  }
  assert.ok(!/candidate\//.test(fs.readFileSync(path.join(__dirname, '..', 'bin', 'tii.js'), 'utf8')));
});
