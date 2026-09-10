#!/usr/bin/env node
'use strict';

/**
 * §30 large-payload + §31 scale tests.
 *   node spec/audit/performance-audit.js [--scale 100,1000,10000]
 * Isolated temp ledgers; generated data is NOT committed. Writes
 * spec/performance-results.json.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(REPO + '/src/ledger');
const { project } = require(REPO + '/src/projection');
const exporters = require(REPO + '/src/export');
const views = require(REPO + '/src/views');

const ms = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; };
const mb = (n) => +(n / 1048576).toFixed(2);
const mem = () => mb(process.memoryUsage().heapUsed);

/* ---------------------------------------------- §30 large payload ---------- */
const payloadResults = [];
for (const size of [1024, 100 * 1024, 1024 * 1024, 10 * 1024 * 1024]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-pl-'));
  const l = new Ledger(path.join(dir, 'l.jsonl')).load();
  const { tii } = l.issueTII({ recorder: { id: 'x', kind: 'person' } });
  const blob = crypto.randomBytes(Math.floor(size * 0.7)).toString('base64'); // ~size chars
  const append = ms(() => l.append({ tii, event_type: 'evidence.referenced', recorder: { id: 'x', kind: 'person' }, content: { module: 'evidence', ref: 'big', act: 'introduce', inline_payload: blob } }));
  const p0 = ms(() => project(l.forTII(tii)));
  const render = ms(() => views.resolutionPage({ lang: 'en', p: p0.r }));
  const jsonl = ms(() => exporters.toJSONL(l));
  const staticb = ms(() => exporters.buildStaticSite(l, path.join(dir, 'pub')));
  const verify = ms(() => l.verify());
  payloadResults.push({
    payload_bytes: size, payload_label: size >= 1048576 ? mb(size) + ' MB' : (size / 1024) + ' KB',
    append_ms: +append.ms.toFixed(1), project_ms: +p0.ms.toFixed(1), render_ms: +render.ms.toFixed(1),
    jsonl_export_ms: +jsonl.ms.toFixed(1), rebuild_static_ms: +staticb.ms.toFixed(1), verify_ms: +verify.ms.toFixed(1),
    ledger_file_bytes: fs.statSync(l.file).size,
    render_html_bytes: render.r.length,
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------------------------------------------- §31 scale ----------------- */
const scaleArg = (process.argv.find((a) => a.startsWith('--scale=')) || '--scale=100,1000,10000').split('=')[1];
const scales = scaleArg.split(',').map(Number);
const scaleResults = [];
for (const N of scales) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-sc-'));
  const file = path.join(dir, 'l.jsonl');
  const l = new Ledger(file).load();
  const memBefore = mem();
  const issue = ms(() => { for (let i = 0; i < N; i++) l.issueTII({ recorder: { id: 'gen', kind: 'mechanism' } }); });
  const tiis = l.listTIIs();
  // ~4 events each
  const appendT = ms(() => {
    for (const tii of tiis) {
      l.append({ tii, event_type: 'interpretation.revised', recorder: { id: 'gen', kind: 'mechanism' }, content: { module: 'interpretation', ref: 'w', description: 'scale test ' + tii } });
      l.append({ tii, event_type: 'address.described', recorder: { id: 'gen', kind: 'mechanism' }, content: { module: 'address', ref: 'a', act: 'introduce', kind: 'public-location', value: 'https://h/' + tii } });
      l.append({ tii, event_type: 'external.ref.added', recorder: { id: 'gen', kind: 'mechanism' }, content: { module: 'external_identifier', ref: 'd', act: 'introduce', scheme: 'doi', value: '10.1/' + tii } });
      l.append({ tii, event_type: 'ignition.described', recorder: { id: 'gen', kind: 'mechanism' }, content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'x' } });
    }
  });
  const totalEvents = l.events.length;
  const one = tiis[Math.floor(tiis.length / 2)];
  const lookup = ms(() => project(l.forTII(one)));
  const registry = ms(() => views.registryPage({ lang: 'en', summaries: tiis.map((t) => exporters.publicSummary(project(l.forTII(t)))) }));
  const verify = ms(() => l.verify());
  const jsonExp = ms(() => exporters.toJSON(l));
  const jsonlExp = ms(() => exporters.toJSONL(l));
  const csvExp = ms(() => exporters.toCSV(l));
  const staticb = ms(() => exporters.buildStaticSite(l, path.join(dir, 'pub')));
  const fileSize = fs.statSync(file).size;
  const startup = ms(() => new Ledger(file).load());
  scaleResults.push({
    tiis: N, total_events: totalEvents,
    issue_ms: +issue.ms.toFixed(0), issue_per_sec: Math.round(N / (issue.ms / 1000)),
    append_ms: +appendT.ms.toFixed(0), append_per_sec: Math.round((totalEvents - N) / (appendT.ms / 1000)),
    single_tii_lookup_ms: +lookup.ms.toFixed(2),
    registry_render_ms: +registry.ms.toFixed(0),
    verify_ms: +verify.ms.toFixed(0), verify_events_per_sec: Math.round(totalEvents / (verify.ms / 1000)),
    json_export_ms: +jsonExp.ms.toFixed(0), jsonl_export_ms: +jsonlExp.ms.toFixed(0), csv_export_ms: +csvExp.ms.toFixed(0),
    rebuild_static_ms: +staticb.ms.toFixed(0), rebuild_static_files: N * 4 + 12,
    ledger_bytes: fileSize, ledger_mb: mb(fileSize),
    reload_startup_ms: +startup.ms.toFixed(0),
    heap_delta_mb: +(mem() - memBefore).toFixed(1),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (global.gc) global.gc();
}

const report = {
  generated_at: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0] && os.cpus()[0].model,
  note: 'Generated ledgers are NOT committed. Regenerate with: node spec/audit/performance-audit.js',
  large_payload: payloadResults,
  scale: scaleResults,
  interpretation: {
    large_payload:
      'append/verify scale linearly with payload size. The whole event (incl. a 10 MB inline blob) is one JSONL line held in memory and re-serialized on every export/verify. rebuild-static writes the blob into the per-TII .json and .html. Practical inline limit: the HTTP body cap is 5 MB (src/server.js); the CLI has no cap. Large evidence SHOULD be referenced by content_verification hash + an address, not stored inline.',
    scale:
      'All operations are O(events). verify() re-hashes every event on every call and on every rebuild-static. registry render calls project() once per TII. rebuild-static writes 2 HTML + 1 JSON per TII per language (~4 files/TII) plus 3 ledger dumps. No index, no pagination, no incremental build. Everything is in memory (Ledger.events holds all events). Startup re-parses the whole file.',
  },
};
fs.writeFileSync(path.join(REPO, 'spec', 'performance-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
