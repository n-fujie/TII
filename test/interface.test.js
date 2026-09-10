'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const views = require('../src/views');
const { project } = require('../src/projection');
const exporters = require('../src/export');
const { renderMarkdown } = require('../src/md');
const { withTII, freshLedger } = require('./helpers');

const EN_DESC = 'A reference infrastructure for tracing when distinctions';

/* ------------------------------------------------------------- homepage --- */

test('homepage is English-first and functions as a resolver entry point', () => {
  const html = views.homePage({ lang: 'en' });
  assert.match(html, /Transition-Ignition Identifier/);
  assert.match(html, /Resolve/);
  assert.match(html, new RegExp(EN_DESC));
  assert.match(html, /Experimental Specification/);
  assert.match(html, /<form class="resolve"/);
});

test('homepage default language (unspecified) is English', () => {
  assert.match(views.homePage({}), new RegExp(EN_DESC));
});

test('homepage does not carry development-status labels or debug output', () => {
  const html = views.homePage({ lang: 'en' });
  for (const bad of ['PROVISIONAL', 'Trial Version', 'Read-only', 'read-only mirror']) {
    assert.ok(!html.includes(bad), `homepage must not contain "${bad}"`);
  }
  // no registry table, no hash-chain verification output in the first view
  assert.ok(!/<table/.test(html), 'homepage must not contain a table');
  assert.ok(!/head hash|hash chain|SHA-256/i.test(html), 'homepage must not show audit output');
});

test('Japanese homepage is a separate rendering, not interleaved with English', () => {
  const ja = views.homePage({ lang: 'ja' });
  assert.match(ja, /区別・関係・機能・分類/);
  assert.ok(!ja.includes(EN_DESC), 'JA view must not contain the English description sentence');
  assert.match(ja, /実験的仕様/);
});

/* ------------------------------------------------------------- header --- */

test('site header is clean: wordmark + subtitle + public nav only', () => {
  const html = views.homePage({ lang: 'en' });
  for (const item of ['Registry', 'Specification', 'Audit', 'About']) {
    assert.match(html, new RegExp(`>${item}<`));
  }
  // admin / issue are not exposed in the public navigation
  const header = html.slice(0, html.indexOf('</header>'));
  assert.ok(!/>Admin<|>Issue<|>Ledger</.test(header), 'no admin / issue / ledger in public nav');
  assert.ok(!/Trial Version|PROVISIONAL/.test(header));
});

/* ------------------------------------------------------------ registry --- */

test('registry lists identifiers and marks test identifiers distinctly', () => {
  const summaries = [
    {
      tii: 'tii:aaaaaaaaaaaa',
      slug: 'tii_aaaaaaaaaaaa',
      identifier_status: 'test',
      lifecycle_state: 'active',
      last_event_type: 'note.added',
      last_recorded_at: '2026-02-01T00:00:00.000Z',
      recorded_at: '2026-01-01T00:00:00.000Z',
      external_ids: ['doi'],
      disputes: 0,
    },
  ];
  const html = views.registryPage({ lang: 'en', summaries });
  assert.match(html, /tii:aaaaaaaaaaaa/);
  assert.match(html, /TEST IDENTIFIER/);
  assert.match(html, /Record status/);
  assert.match(html, /Last recorded event/);
});

/* ---------------------------------------------------------- resolution --- */

function projectionWith(events) {
  const ledger = freshLedger();
  const { tii } = ledger.issueTII({ recorder: 'tester' });
  for (const e of events) ledger.append({ tii, recorder: 'tester', ...e });
  return project(ledger.forTII(tii));
}

test('resolution page shows only modules that have records', () => {
  const p = projectionWith([
    { event_type: 'interpretation.revised', content: { module: 'interpretation', ref: 'w', description: 'tracks X' } },
    { event_type: 'address.described', content: { module: 'address', ref: 'a', act: 'introduce', kind: 'public-location', value: 'https://example.org' } },
  ]);
  const html = views.resolutionPage({ lang: 'en', p });
  assert.match(html, /id="address-domain"/);
  assert.match(html, /id="overview"/);
  assert.ok(!/id="transitions"/.test(html), 'no empty Transitions section');
  assert.ok(!/id="ignitions"/.test(html), 'no empty Ignitions section');
  assert.match(html, /TEST IDENTIFIER/);
});

test('resolution page does not fabricate a current state when none exists', () => {
  const p = projectionWith([
    { event_type: 'ignition.described', content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'F' } },
    { event_type: 'ignition.withdrawn', content: { module: 'ignition', ref: 'i', act: 'withdraw', reason: 'retracted' } },
  ]);
  const html = views.resolutionPage({ lang: 'en', p });
  assert.match(html, /id="ignitions"/);
  assert.match(html, /No record is currently interpreted as valid/);
});

test('resolution page only shows a resolver URL when one is configured', () => {
  const p = projectionWith([
    { event_type: 'note.added', content: { module: 'note', ref: 'n', text: 'x' } },
  ]);
  assert.ok(!/Resolvable at/.test(views.resolutionPage({ lang: 'en', p })));
  assert.match(
    views.resolutionPage({ lang: 'en', p, resolverBase: 'https://tii.example.org' }),
    /https:\/\/tii\.example\.org\/tii\/tii:/
  );
});

test('missing identifier resolves to an explicit not-found page, not an error', () => {
  const html = views.resolutionPage({ lang: 'en', p: { exists: false, tii: 'tii:zzzzzzzzzzzz' } });
  assert.match(html, /not found/i);
  assert.match(html, /tii:zzzzzzzzzzzz/);
});

/* -------------------------------------------------------- specification --- */

test('specification states the non-ontological principle and the non-guarantees', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'SPEC.md'), 'utf8');
  assert.match(
    md,
    /Transition and ignition are revisable operational descriptions, not universal ontological primitives/
  );
  for (const term of ['essential identity', 'ownership', 'authenticity', 'scholarly validity', 'persistence of hosting', 'correctness of classification']) {
    assert.ok(md.includes(term), `SPEC.md must state it does not guarantee: ${term}`);
  }
  assert.match(md, /records and exposes traceable assertions, relations,/);
  assert.match(md, /evidence, contestation, and revision/);
  // core vs optional modules
  assert.match(md, /## 5\. TII Core/);
  assert.match(md, /## 6\. Optional descriptive modules/);
  // renders without throwing
  assert.ok(renderMarkdown(md).includes('<h1>'));
});

test('specification page renders as structured HTML, not a raw pre block', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'SPEC.md'), 'utf8');
  const html = views.docPage({ lang: 'en', title: 'Specification', path: '/spec', markdown: md });
  assert.match(html, /<h2>1\. Purpose<\/h2>/);
  assert.ok(!/<pre>[\s\S]*## 1\. Purpose/.test(html), 'spec must not be dumped in a <pre>');
});

/* ---------------------------------------------------------------- audit --- */

test('audit page is a dedicated page showing hash-chain status', () => {
  const html = views.auditPage({
    lang: 'en',
    verification: { ok: true, event_count: 3, head_hash: 'abc', problems: [] },
    generatedAt: '2026-02-02T00:00:00.000Z',
  });
  assert.match(html, /<title>Audit — TII<\/title>/);
  assert.match(html, /Ledger integrity/);
  assert.match(html, /Head hash/);
  assert.match(html, /SHA-256/);
});

/* --------------------------------------------------------- static build --- */

test('static build produces English and Japanese pages for every public route', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { module: 'note', ref: 'n', text: 'x' } });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ui-')), 'public');
  exporters.buildStaticSite(ledger, out);

  for (const f of ['index.html', 'registry.html', 'spec.html', 'audit.html', 'about.html', '404.html']) {
    assert.ok(fs.existsSync(path.join(out, f)), `public/${f}`);
    assert.ok(fs.existsSync(path.join(out, 'ja', f)), `public/ja/${f}`);
  }
  assert.ok(fs.existsSync(path.join(out, 'tii', 'tii_' + tii.slice(4) + '.html')));
  assert.ok(fs.existsSync(path.join(out, 'ja', 'tii', 'tii_' + tii.slice(4) + '.html')));
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), new RegExp(EN_DESC));
});

test('static homepage carries no hosting-provider identity and no dev-status header', () => {
  const { ledger } = withTII();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ui2-')), 'public');
  exporters.buildStaticSite(ledger, out);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(!/vercel|PROVISIONAL|Trial Version/i.test(html));
});
