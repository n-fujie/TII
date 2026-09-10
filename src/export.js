'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { project } = require('./projection');
const { tiiToFileSlug } = require('./id');
const views = require('./views');

const REPO_ROOT = path.join(__dirname, '..');

/** Full ledger as a JSON array. */
function toJSON(ledger) {
  return JSON.stringify(ledger.events, null, 2);
}

/** Full ledger as JSON Lines (this is the canonical on-disk form). */
function toJSONL(ledger) {
  return ledger.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

const CSV_COLUMNS = [
  'seq', 'event_id', 'tii', 'recorded_at', 'ledger_written_at', 'recorder_id', 'recorder_kind',
  'event_type', 'module', 'ref', 'act', 'content_json', 'basis_json', 'external_refs_json',
  'content_verification_json', 'supersedes', 'prev_event_for_target', 'prev_hash', 'hash',
];

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Flatten every event to one CSV row. content is kept as JSON in one column. */
function toCSV(ledger) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const e of ledger.events) {
    const c = e.content || {};
    const row = [
      e.seq, e.event_id, e.tii, e.recorded_at, e.ledger_written_at,
      e.recorder && e.recorder.id, e.recorder && e.recorder.kind, e.event_type,
      c.module || '', c.ref || '', c.act || '',
      JSON.stringify(c), JSON.stringify(e.basis || []), JSON.stringify(e.external_refs || []),
      e.content_verification ? JSON.stringify(e.content_verification) : '',
      e.supersedes || '', e.prev_event_for_target || '', e.prev_hash, e.hash,
    ];
    rows.push(row.map(csvCell).join(','));
  }
  return rows.join('\n') + '\n';
}

/** Restrained public summary of one TII, used by the Registry. */
function publicSummary(p) {
  const last = p.events[p.events.length - 1] || {};
  return {
    tii: p.tii,
    slug: tiiToFileSlug(p.tii),
    identifier_status: p.identifier_status,
    lifecycle_state: p.lifecycle_state,
    last_event_type: last.event_type || null,
    last_recorded_at: p.last_recorded_at,
    recorded_at: p.issued ? p.issued.recorded_at : null,
    external_ids: [...new Set((p.references || []).map((r) => r.scheme || r.source).filter(Boolean))],
    disputes: p.disputes.length,
    event_count: p.event_count,
  };
}

function readDoc(name) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, name), 'utf8');
  } catch {
    return `# ${name}\n\nNot found.`;
  }
}

const DOCS = {
  spec: { en: 'SPEC.md', ja: 'SPEC.ja.md', title: { en: 'Specification', ja: '仕様' }, path: '/spec' },
  about: { en: 'ABOUT.md', ja: 'ABOUT.ja.md', title: { en: 'About', ja: '概要' }, path: '/about' },
};

/**
 * Rebuild all TII records + the public site as a static file tree (SPEC.md §10).
 * Given only ledger.jsonl this reproduces the same identifiers and derived state
 * with no server, database, or cloud service. English at the root, Japanese
 * under /ja.
 */
function buildStaticSite(ledger, outDir, options = {}) {
  const resolverBase = options.resolverBase || process.env.TII_RESOLVER_BASE_URL || '';
  const generatedAt = new Date().toISOString();
  const verification = ledger.verify();

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'tii'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'ja', 'tii'), { recursive: true });

  // Machine formats + canonical ledger copy.
  fs.writeFileSync(path.join(outDir, 'ledger.jsonl'), toJSONL(ledger));
  fs.writeFileSync(path.join(outDir, 'ledger.json'), toJSON(ledger));
  fs.writeFileSync(path.join(outDir, 'ledger.csv'), toCSV(ledger));

  const summaries = [];
  for (const tii of ledger.listTIIs()) {
    const p = project(ledger.forTII(tii));
    const slug = tiiToFileSlug(tii);
    fs.writeFileSync(path.join(outDir, 'tii', slug + '.json'), JSON.stringify(p, null, 2));
    fs.writeFileSync(
      path.join(outDir, 'tii', slug + '.html'),
      views.resolutionPage({ lang: 'en', p, resolverBase })
    );
    fs.writeFileSync(
      path.join(outDir, 'ja', 'tii', slug + '.html'),
      views.resolutionPage({ lang: 'ja', p, resolverBase })
    );
    summaries.push(publicSummary(p));
  }

  for (const lang of ['en', 'ja']) {
    const dir = lang === 'ja' ? path.join(outDir, 'ja') : outDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), views.homePage({ lang }));
    fs.writeFileSync(path.join(dir, 'registry.html'), views.registryPage({ lang, summaries }));
    fs.writeFileSync(
      path.join(dir, 'audit.html'),
      views.auditPage({ lang, verification, generatedAt, exportBase: '/ledger' })
    );
    for (const [, d] of Object.entries(DOCS)) {
      fs.writeFileSync(
        path.join(dir, path.basename(d.path) + '.html'),
        views.docPage({ lang, title: d.title[lang], path: d.path, markdown: readDoc(d[lang]) })
      );
    }
    fs.writeFileSync(path.join(dir, '404.html'), views.notFoundPage({ lang }));
  }
  fs.writeFileSync(path.join(outDir, '404.html'), views.notFoundPage({ lang: 'en' }));

  fs.writeFileSync(
    path.join(outDir, 'catalog.json'),
    JSON.stringify({ generated_at: generatedAt, verification, resolver_base: resolverBase, identifiers: summaries }, null, 2)
  );

  return { outDir, tii_count: summaries.length, verification };
}

module.exports = { toJSON, toJSONL, toCSV, buildStaticSite, publicSummary, readDoc, DOCS, CSV_COLUMNS };
