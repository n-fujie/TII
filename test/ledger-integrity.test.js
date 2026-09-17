'use strict';

/**
 * Canonical ledger integrity under localization and rendering.
 *
 * Invariant under test (normative — see SPEC.md "No display-driven mutation"):
 *   No public rendering, localization, projection, export formatting, or
 *   documentation change may mutate previously recorded canonical events.
 *
 * A translation is an appended event, never a rewrite of the source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Ledger } = require('../src/ledger');
const { project, displayContent } = require('../src/projection');
const views = require('../src/views');
const exporters = require('../src/export');
const { freshLedger } = require('./helpers');

const REPO = path.join(__dirname, '..');

/* ------------------------------------------------------------- utilities --- */

const ledgerBytes = (l) => fs.readFileSync(l.file);
const hashMap = (l) => {
  const m = {};
  for (const e of new Ledger(l.file).load().events) m[e.event_id] = e.hash;
  return m;
};

function seededJapanese() {
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: { id: 'author', kind: 'person' } });
  const ja = l.append({
    tii,
    event_type: 'note.added',
    recorder: { id: 'author', kind: 'person' },
    content: { module: 'note', ref: 'n1', act: 'introduce', description: '日本語で作成された記録', language: 'ja' },
  });
  return { l, tii, ja };
}

function addLocalization(l, tii, sourceId, targetLang, text) {
  return l.append({
    tii,
    event_type: 'localization.added',
    recorder: { id: 'translator', kind: 'person' },
    content: {
      module: 'localization',
      ref: sourceId,
      source_event: sourceId,
      source_language: 'ja',
      target_language: targetLang,
      kind: 'literal',
      translated_content: { description: text },
    },
  });
}

function renderAll(l, tii) {
  const p = project(l.forTII(tii));
  const summaries = [exporters.publicSummary(p)];
  views.homePage({ lang: 'en' });
  views.homePage({ lang: 'ja' });
  views.registryPage({ lang: 'en', summaries });
  views.registryPage({ lang: 'ja', summaries });
  views.resolutionPage({ lang: 'en', p });
  views.resolutionPage({ lang: 'ja', p });
  views.docPage({ lang: 'en', title: 'Spec', path: '/spec', markdown: '# x' });
  views.auditPage({ lang: 'en', verification: l.verify() });
}

/* ----------------------------------------------------------- A,B,C,I,§9 --- */

test('A/§9 switching EN <-> JA rendering does not mutate ledger.jsonl', () => {
  const { l, tii } = seededJapanese();
  addLocalization(l, tii, l.forTII(tii)[1].event_id, 'en', 'A record authored in Japanese');
  const before = ledgerBytes(l);
  const beforeMtime = fs.statSync(l.file).mtimeMs;
  for (let i = 0; i < 5; i++) renderAll(l, tii);
  assert.deepEqual(ledgerBytes(l), before, 'ledger bytes unchanged by rendering');
  assert.equal(fs.statSync(l.file).mtimeMs, beforeMtime, 'ledger file not even touched');
});

test('B/C rendering an EN or JA page alters no event hash', () => {
  const { l, tii } = seededJapanese();
  addLocalization(l, tii, l.forTII(tii)[1].event_id, 'en', 'English translation');
  const before = hashMap(l);
  views.resolutionPage({ lang: 'en', p: project(l.forTII(tii)) });
  views.resolutionPage({ lang: 'ja', p: project(l.forTII(tii)) });
  assert.deepEqual(hashMap(l), before);
});

test('I verify() still validates the full chain after localization is appended', () => {
  const { l, tii } = seededJapanese();
  addLocalization(l, tii, l.forTII(tii)[1].event_id, 'en', 'x');
  addLocalization(l, tii, l.forTII(tii)[1].event_id, 'fr', 'y');
  const v = l.verify();
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.event_count, 4);
});

/* --------------------------------------------------------------- D,E,F,G,H --- */

test('D adding a translation appends a new event and never rewrites the source', () => {
  const { l, tii, ja } = seededJapanese();
  const sourceBefore = JSON.parse(JSON.stringify(l.getEvent(ja.event_id)));
  const countBefore = l.events.length;

  const loc = addLocalization(l, tii, ja.event_id, 'en', 'English rendering');

  assert.equal(l.events.length, countBefore + 1);
  assert.deepEqual(l.getEvent(ja.event_id), sourceBefore, 'source event byte-identical');
  assert.equal(loc.supersedes, undefined, 'a translation does not supersede the source');
  assert.equal(loc.event_type, 'localization.added');
});

test('E/F/G/H original authored content, id, timestamp and hash survive translation + correction', () => {
  const { l, tii, ja } = seededJapanese();
  const { event_id, recorded_at, hash } = ja;
  const authored = l.getEvent(ja.event_id).content.description;

  addLocalization(l, tii, ja.event_id, 'en', 'first English translation');
  addLocalization(l, tii, ja.event_id, 'en', 'corrected English translation'); // L

  const src = l.getEvent(ja.event_id);
  assert.equal(src.event_id, event_id);
  assert.equal(src.recorded_at, recorded_at);
  assert.equal(src.hash, hash);
  assert.equal(src.content.description, authored, 'authored content still says the Japanese text');
  assert.equal(src.content.description, '日本語で作成された記録');
});

/* --------------------------------------------------------------- L --- */

test('L a translation may be corrected by appending another event; the prior translation is kept', () => {
  const { l, tii, ja } = seededJapanese();
  const first = addLocalization(l, tii, ja.event_id, 'en', 'v1');
  const second = addLocalization(l, tii, ja.event_id, 'en', 'v2');

  assert.ok(l.getEvent(first.event_id), 'first translation event still present in the ledger');
  assert.ok(l.getEvent(second.event_id));

  const p = project(l.forTII(tii));
  const srcView = p.events.find((e) => e.event_id === ja.event_id);
  assert.equal(displayContent(p, srcView, 'en').content.description, 'v2', 'latest translation wins for display');
  assert.equal(displayContent(p, srcView, 'ja').content.description, '日本語で作成された記録', 'ja falls back to authored');
});

/* --------------------------------------------------------------- K --- */

test('K a third language needs no core/schema change', () => {
  const { l, tii, ja } = seededJapanese();
  const STD_KEYS = Object.keys(l.getEvent(ja.event_id)).sort();

  const fr = addLocalization(l, tii, ja.event_id, 'fr', 'un enregistrement rédigé en japonais');
  const de = addLocalization(l, tii, ja.event_id, 'de', 'ein auf Japanisch verfasster Eintrag');

  assert.deepEqual(Object.keys(fr).sort(), STD_KEYS, 'no new top-level event fields for a new language');
  assert.deepEqual(Object.keys(de).sort(), STD_KEYS);
  assert.equal(l.verify().ok, true);

  const p = project(l.forTII(tii));
  const srcView = p.events.find((e) => e.event_id === ja.event_id);
  assert.match(displayContent(p, srcView, 'fr').content.description, /rédigé en japonais/);
  assert.match(displayContent(p, srcView, 'de').content.description, /auf Japanisch/);
});

test('the codebase hard-codes no per-language content fields', () => {
  for (const f of ['src/projection.js', 'src/views.js', 'src/export.js', 'src/ledger.js', 'src/i18n.js']) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.ok(!/description_(en|ja|[a-z]{2})\b/.test(src), `${f} must not hard-code description_<lang>`);
  }
});

/* --------------------------------------------------------------- J / §11 --- */

test('J/§11 rebuild-static is a pure derivation: the ledger is byte-for-byte unchanged', () => {
  const { l, tii } = seededJapanese();
  addLocalization(l, tii, l.forTII(tii)[1].event_id, 'en', 'English');
  const before = ledgerBytes(l);
  const beforeHashes = hashMap(l);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-rb-')), 'public');
  exporters.buildStaticSite(l, out);
  exporters.buildStaticSite(l, out); // twice

  assert.deepEqual(ledgerBytes(l), before, 'canonical ledger unchanged after rebuild-static');
  assert.deepEqual(hashMap(l), beforeHashes);
  // and the derived copy in the output is the canonical ledger verbatim
  assert.equal(fs.readFileSync(path.join(out, 'ledger.jsonl'), 'utf8'), exporters.toJSONL(l));
});

/* --------------------------------------------------- §17 acceptance test --- */

test('§17 acceptance: JA event, EN translation, corrected translation — nothing rewritten, all verifiable', () => {
  // 1. issue
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: { id: 'author', kind: 'person' } });
  // 2. record an event in Japanese
  const jaEvent = l.append({
    tii,
    event_type: 'interpretation.revised',
    recorder: { id: 'author', kind: 'person' },
    content: { module: 'interpretation', ref: 'what', description: 'この参照点の追跡対象', language: 'ja' },
  });
  const jaSnapshot = JSON.parse(JSON.stringify(l.getEvent(jaEvent.event_id)));
  // 3. verify
  assert.equal(l.verify().ok, true);
  // 4. add an English translation
  const en1 = addLocalization(l, tii, jaEvent.event_id, 'en', 'What this reference point tracks');
  // 5. verify again
  assert.equal(l.verify().ok, true);
  // 6/7. render EN + JA
  const pMid = project(l.forTII(tii));
  const enHtml = views.resolutionPage({ lang: 'en', p: pMid });
  const jaHtml = views.resolutionPage({ lang: 'ja', p: pMid });
  assert.match(enHtml, /What this reference point tracks/);
  assert.match(jaHtml, /この参照点の追跡対象/);
  // 8. correct the English translation
  const en2 = addLocalization(l, tii, jaEvent.event_id, 'en', 'The subject this reference point tracks');
  // 9. render both again
  const pLate = project(l.forTII(tii));
  assert.match(views.resolutionPage({ lang: 'en', p: pLate }), /The subject this reference point tracks/);
  assert.match(views.resolutionPage({ lang: 'ja', p: pLate }), /この参照点の追跡対象/);
  // 10. rebuild the static site
  const ledgerBefore = ledgerBytes(l);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-acc-')), 'public');
  exporters.buildStaticSite(l, out);
  assert.deepEqual(ledgerBytes(l), ledgerBefore, 'static rebuild left the ledger unchanged');
  // 11. export the full ledger
  const jsonl = exporters.toJSONL(l);
  // 12. reconstruct it elsewhere
  const elsewhere = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-elsewhere-')), 'ledger.jsonl');
  fs.writeFileSync(elsewhere, jsonl);
  const rebuilt = new Ledger(elsewhere).load();

  // end state assertions
  assert.deepEqual(rebuilt.getEvent(jaEvent.event_id), jaSnapshot, 'original Japanese event unchanged');
  assert.ok(rebuilt.getEvent(en1.event_id), 'first English translation still exists as historical data');
  assert.ok(rebuilt.getEvent(en2.event_id), 'corrected English translation exists as a later record');
  assert.equal(rebuilt.getEvent(en1.event_id).content.translated_content.description, 'What this reference point tracks');
  assert.equal(rebuilt.verify().ok, true, 'all historical hashes remain verifiable');
  assert.equal(rebuilt.events.length, 4);

  // the full archival export lets another implementation distinguish source vs localization
  const srcRow = JSON.parse(jsonl.split('\n')[1]);
  const locRow = JSON.parse(jsonl.split('\n').filter(Boolean).find((x) => x.includes('localization.added')));
  assert.equal(srcRow.content.language, 'ja');
  assert.equal(locRow.content.source_event, jaEvent.event_id);
  assert.equal(locRow.content.target_language, 'en');
});

/* ----------------------------------------------- committed canonical ledger --- */

test('the committed data/ledger.jsonl is clean and append-only valid', () => {
  const file = path.join(REPO, 'data', 'ledger.jsonl');
  const raw = fs.readFileSync(file, 'utf8');
  const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));

  // no per-language hard-coded fields anywhere in canonical content
  assert.ok(!/"description_(en|ja)"/.test(raw), 'no description_en / description_ja in the canonical ledger');
  // the hosting-provider hostname is not written into canonical identity
  assert.ok(!/tiiarchive\.vercel\.app/.test(raw), 'Vercel hostname is not canonical');

  // Historical invariant, corrected 2026-09-17 after the first authorized
  // production issuance (spec/production-issuance-authorization-record.md,
  // spec/first-production-issuance-runbook-reviewed.md). The original
  // assertion here ("every issued identifier is still a test identifier")
  // was a pre-authorization guard against production issuance happening
  // before proper authorization — it is not weakened by this update, it is
  // corrected to match the now-authorized reality it was written to guard
  // against. This does NOT categorically forbid future production
  // issuances; it fixes exactly one already-reviewed historical fact and
  // protects everything strictly before it.
  const FIRST_PRODUCTION_ISSUANCE = {
    event_id: 'evt_bfrbdmdd6sprept3',
    tii: 'tii:fabdi3ifjwteyi3os2hwmx2l5i',
    seq: 10,
    hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc',
  };
  const issuedEvents = events.filter((e) => e.event_type === 'tii.issued');
  const firstProduction = issuedEvents.find((e) => e.content.identifier_status === 'production');

  assert.ok(firstProduction, 'the already-reviewed first production issuance must still exist in the committed ledger');
  assert.equal(firstProduction.event_id, FIRST_PRODUCTION_ISSUANCE.event_id, 'the first production issuance must still be the exact, already-reviewed event, not a different one');
  assert.equal(firstProduction.tii, FIRST_PRODUCTION_ISSUANCE.tii);
  assert.equal(firstProduction.seq, FIRST_PRODUCTION_ISSUANCE.seq);
  assert.equal(firstProduction.hash, FIRST_PRODUCTION_ISSUANCE.hash);

  // Every tii.issued event strictly BEFORE the first authorized production
  // issuance must remain identifier_status "test" — this is the actual
  // safety invariant: no pre-authorization issuance may be silently
  // reclassified. Events after it (a hypothetical future production
  // issuance) are deliberately NOT constrained here — this test fixes one
  // historical fact, it does not impose a "at most one production
  // identifier, ever" rule.
  for (const e of issuedEvents) {
    if (e.seq < FIRST_PRODUCTION_ISSUANCE.seq) {
      assert.equal(e.content.identifier_status, 'test', `event ${e.event_id} (seq ${e.seq}) predates the first authorized production issuance and must remain identifier_status: "test"`);
    }
  }

  // chain verifies
  assert.equal(new Ledger(file).load().verify().ok, true);

  // the first six events are exactly the ones committed in 9cfbca5 (restored, not rewritten)
  assert.equal(events[0].event_id, 'evt_tx7tn6adz0zjvgna');
  assert.equal(events[0].hash, '00253180362f392b8e32387b08617351fcb77a38b009fdc4960690ec694338ec');
  assert.equal(events[5].hash, '48e3c6618695184e408734622aea0c1c87c51eec1ea8db8f772149d818a5d6ac');
  assert.equal(events[0].content.tracking_started_note, 'TII仕様策定の参照点', 'Japanese-authored content preserved');
});
