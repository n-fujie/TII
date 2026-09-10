'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { project } = require('./projection');
const { tiiToFileSlug } = require('./id');
const { renderResolutionPage, renderIndexPage, renderSpecPage } = require('./views');

/** Full ledger as a JSON array. */
function toJSON(ledger) {
  return JSON.stringify(ledger.events, null, 2);
}

/** Full ledger as JSON Lines (this is the canonical on-disk form). */
function toJSONL(ledger) {
  return ledger.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

const CSV_COLUMNS = [
  'seq',
  'event_id',
  'tii',
  'recorded_at',
  'ledger_written_at',
  'recorder_id',
  'recorder_kind',
  'event_type',
  'module',
  'ref',
  'act',
  'content_json',
  'basis_json',
  'external_refs_json',
  'content_verification_json',
  'supersedes',
  'prev_event_for_target',
  'prev_hash',
  'hash',
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
      e.seq,
      e.event_id,
      e.tii,
      e.recorded_at,
      e.ledger_written_at,
      e.recorder && e.recorder.id,
      e.recorder && e.recorder.kind,
      e.event_type,
      c.module || '',
      c.ref || '',
      c.act || '',
      JSON.stringify(c),
      JSON.stringify(e.basis || []),
      JSON.stringify(e.external_refs || []),
      e.content_verification ? JSON.stringify(e.content_verification) : '',
      e.supersedes || '',
      e.prev_event_for_target || '',
      e.prev_hash,
      e.hash,
    ];
    rows.push(row.map(csvCell).join(','));
  }
  return rows.join('\n') + '\n';
}

/**
 * Rebuild all TII records as a static file tree (要件20, 26.22, 26.23).
 * Given only ledger.jsonl this reproduces the same TII strings and the same
 * derived state with no server, database, or cloud service.
 */
function buildStaticSite(ledger, outDir, options = {}) {
  const host = options.host || '';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'tii'), { recursive: true });

  // Canonical ledger copy + machine formats.
  fs.writeFileSync(path.join(outDir, 'ledger.jsonl'), toJSONL(ledger));
  fs.writeFileSync(path.join(outDir, 'ledger.json'), toJSON(ledger));
  fs.writeFileSync(path.join(outDir, 'ledger.csv'), toCSV(ledger));

  const verification = ledger.verify();
  const tiis = ledger.listTIIs();
  const summaries = [];

  for (const tii of tiis) {
    const p = project(ledger.forTII(tii));
    const slug = tiiToFileSlug(tii);
    fs.writeFileSync(
      path.join(outDir, 'tii', slug + '.json'),
      JSON.stringify(p, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, 'tii', slug + '.html'),
      renderResolutionPage(p, { static: true, host })
    );
    summaries.push({
      tii,
      slug,
      identifier_status: p.identifier_status,
      lifecycle_state: p.lifecycle_state,
      last_recorded_at: p.last_recorded_at,
      event_count: p.event_count,
      disputes: p.disputes.length,
    });
  }

  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    renderIndexPage({ summaries, recent: [], verification, static: true })
  );
  fs.writeFileSync(path.join(outDir, 'spec.html'), renderSpecPage({ static: true }));
  fs.writeFileSync(
    path.join(outDir, 'catalog.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), verification, tiis: summaries }, null, 2)
  );

  return { outDir, tii_count: tiis.length, verification };
}

module.exports = { toJSON, toJSONL, toCSV, buildStaticSite, CSV_COLUMNS };
