'use strict';

/**
 * src/tii-lookup.js — the single shared, profile-agnostic fragment-split
 * primitive used by src/server.js, the client-side script src/views.js
 * embeds into the static site, and bin/tii.js. See that module's doc
 * comment for why it exists (semantic drift between three previously
 * independent, hand-written copies of this exact logic).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { splitFragment } = require('../src/tii-lookup');
const { Ledger } = require('../src/ledger');

test('splitFragment: no fragment -> base is the trimmed, lowercased input, fragment is null', () => {
  assert.deepEqual(splitFragment('tii:h4r3jsn4p25d'), { base: 'tii:h4r3jsn4p25d', fragment: null });
  assert.deepEqual(splitFragment('  TII:h4r3jsn4p25d  '), { base: 'tii:h4r3jsn4p25d', fragment: null });
});

test('splitFragment: a fragment is split off per RFC 3986 §3.5 ("everything from the first # to the end")', () => {
  assert.deepEqual(splitFragment('tii:h4r3jsn4p25d#note'), { base: 'tii:h4r3jsn4p25d', fragment: 'note' });
  assert.deepEqual(splitFragment('tii:h4r3jsn4p25d#'), { base: 'tii:h4r3jsn4p25d', fragment: '' });
});

test('splitFragment: only the FIRST "#" is the delimiter — everything after it, including further "#"s, is fragment text', () => {
  assert.deepEqual(splitFragment('tii:x#a#b'), { base: 'tii:x', fragment: 'a#b' });
});

test('splitFragment: case-insensitive — the base is folded to lowercase', () => {
  assert.deepEqual(splitFragment('TII:H4R3JSN4P25D#NOTE'), { base: 'tii:h4r3jsn4p25d', fragment: 'note' });
});

test('splitFragment: empty, whitespace-only, null, and undefined input all produce an empty base and no fragment, without throwing', () => {
  for (const input of ['', '   ', null, undefined]) {
    assert.deepEqual(splitFragment(input), { base: '', fragment: null }, `input: ${JSON.stringify(input)}`);
  }
});

test('splitFragment: a bare "#" with nothing before it is an empty base with an empty fragment', () => {
  assert.deepEqual(splitFragment('#'), { base: '', fragment: '' });
});

test('splitFragment: non-string input is coerced via String(), never throws', () => {
  assert.deepEqual(splitFragment(42), { base: '42', fragment: null });
  assert.deepEqual(splitFragment({}), { base: '[object object]', fragment: null });
});

test('splitFragment: idempotent on its own base — re-splitting a fragment-free result is a no-op', () => {
  const once = splitFragment('tii:h4r3jsn4p25d#note');
  const twice = splitFragment(once.base);
  assert.deepEqual(twice, { base: once.base, fragment: null });
});

/* -------------------- single source of truth: no hand-duplication --- */

test('src/server.js resolveIdentifier uses this exact module (no local reimplementation)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/tii-lookup['"]\)/, 'server.js must import the shared primitive, not reimplement fragment-splitting locally');
});

test('src/views.js embeds this exact function\'s source into the client-side script — byte-identical, not a hand-copied duplicate', () => {
  const views = require('../src/views');
  const html = views.homePage({ lang: 'en' });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(
    script.includes(splitFragment.toString()),
    'the embedded script must contain splitFragment.toString() verbatim -- if this fails, someone replaced the embedded call with a hand-written reimplementation, reintroducing the exact drift this module exists to prevent'
  );
});

test('bin/tii.js show/events use this exact module (no local reimplementation)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../bin/tii.js'), 'utf8');
  assert.match(src, /require\(['"]\.\.\/src\/tii-lookup['"]\)/, 'bin/tii.js must import the shared primitive');
});

/* ------------------------------------------------ end-to-end: real CLI --- */

test('CLI — `tii show` and `tii events` resolve a fragment-bearing reference identically to the bare form (real subprocess, real disposable ledger)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-cli-lookup-'));
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const seed = new Ledger(ledgerFile).load();
  const { tii } = seed.issueTII({ recorder: { id: 'seed', kind: 'mechanism' } });

  const binPath = path.join(__dirname, '..', 'bin', 'tii.js');
  const env = { ...process.env, TII_LEDGER: ledgerFile };

  const bare = execFileSync(process.execPath, [binPath, 'show', tii], { env, encoding: 'utf8' });
  const fragmented = execFileSync(process.execPath, [binPath, 'show', tii + '#some-note'], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(bare).tii, tii);
  assert.equal(JSON.parse(fragmented).tii, tii, 'a #fragment must not prevent `tii show` from finding the record');
  assert.deepEqual(JSON.parse(bare), JSON.parse(fragmented));

  const eventsBare = execFileSync(process.execPath, [binPath, 'events', tii], { env, encoding: 'utf8' });
  const eventsFragmented = execFileSync(process.execPath, [binPath, 'events', tii + '#x'], { env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(eventsBare), JSON.parse(eventsFragmented));

  fs.rmSync(dir, { recursive: true, force: true });
});
