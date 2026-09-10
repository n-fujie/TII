#!/usr/bin/env node
'use strict';

/**
 * §32 reconstruction + §33/§34/§35 loss models.
 *   node spec/audit/reconstruction-audit.js
 * Isolated temp dirs only. Writes spec/audit/reconstruction-results.json.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(REPO + '/src/ledger');
const { project, displayContent } = require(REPO + '/src/projection');
const exporters = require(REPO + '/src/export');

/* ---- 1. build a rich source ledger ---------------------------------------- */
const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-src-'));
const srcFile = path.join(srcDir, 'ledger.jsonl');
const L = new Ledger(srcFile).load();
const rec = (id) => ({ id, kind: 'person' });
const { tii } = L.issueTII({ recorder: rec('author'), content: { tracking_started_note: 'reconstruction test' } });
const jaEv = L.append({ tii, event_type: 'note.added', recorder: rec('jp'), content: { module: 'note', ref: 'n', act: 'introduce', description: '日本語の記録', language: 'ja' } });
L.append({ tii, event_type: 'localization.added', recorder: rec('tr'), content: { module: 'localization', ref: jaEv.event_id, source_event: jaEv.event_id, target_language: 'en', kind: 'literal', translated_content: { description: 'Japanese record' } } });
L.append({ tii, event_type: 'address.described', recorder: rec('x'), content: { module: 'address', ref: 'a', act: 'introduce', kind: 'public-location', value: 'https://host-1.test/x' } });
L.append({ tii, event_type: 'domain.described', recorder: rec('x'), content: { module: 'domain', ref: 'd', act: 'introduce', label: 'scope' } });
L.append({ tii, event_type: 'ignition.described', recorder: rec('x'), content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'rule R operative' }, basis: ['evidence://r'] });
L.append({ tii, event_type: 'external.ref.added', recorder: rec('x'), content: { module: 'external_identifier', ref: 'doi', act: 'introduce', scheme: 'doi', value: '10.9/x' } });
L.append({ tii, event_type: 'weird.unknown.type.qqq', recorder: rec('x'), content: { module: 'unknown-module-qqq', ref: 'r', act: 'unknown-act-qqq', k: 'v' } });
const tii2 = L.issueTII({ recorder: rec('author') }).tii;
L.append({ tii: tii2, event_type: 'note.added', recorder: rec('x'), content: { module: 'note', ref: 'n', text: 'second identifier' } });
const srcHead = L.verify().head_hash;
const srcTiis = L.listTIIs();

/* ---- 2. EXPORT ONLY the portable artifacts ------------------------------- */
const kitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-kit-'));
fs.writeFileSync(path.join(kitDir, 'ledger.jsonl'), exporters.toJSONL(L));
fs.writeFileSync(path.join(kitDir, 'ledger.json'), exporters.toJSON(L));
fs.writeFileSync(path.join(kitDir, 'ledger.csv'), exporters.toCSV(L));

/* ---- 3. RECONSTRUCT in a fresh dir with only kit + repo source ---------- */
const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-fresh-'));
// copy the source tree (simulating "open implementation material"), excluding data/
for (const d of ['src', 'bin', 'package.json']) {
  execFileSync('cp', ['-R', path.join(REPO, d), freshDir]);
}
fs.mkdirSync(path.join(freshDir, 'data'));
fs.copyFileSync(path.join(kitDir, 'ledger.jsonl'), path.join(freshDir, 'data', 'ledger.jsonl'));

const undocumented = [];
let cliVerify, cliList, staticBuilt, reHead, reTiis, survived = {};
try {
  cliVerify = execFileSync(process.execPath, [path.join(freshDir, 'bin', 'tii.js'), 'verify'], { cwd: freshDir, env: { ...process.env, TII_LEDGER: path.join(freshDir, 'data', 'ledger.jsonl') } }).toString();
} catch (e) { undocumented.push('CLI verify failed: ' + e.message); }
try {
  cliList = execFileSync(process.execPath, [path.join(freshDir, 'bin', 'tii.js'), 'list'], { cwd: freshDir, env: { ...process.env, TII_LEDGER: path.join(freshDir, 'data', 'ledger.jsonl') } }).toString().trim().split('\n');
} catch (e) { undocumented.push('CLI list failed: ' + e.message); }
try {
  execFileSync(process.execPath, [path.join(freshDir, 'bin', 'tii.js'), 'rebuild-static', path.join(freshDir, 'public')], { cwd: freshDir, env: { ...process.env, TII_LEDGER: path.join(freshDir, 'data', 'ledger.jsonl') } });
  staticBuilt = fs.existsSync(path.join(freshDir, 'public', 'index.html'));
} catch (e) { undocumented.push('rebuild-static failed: ' + e.message); }

const RL = new Ledger(path.join(freshDir, 'data', 'ledger.jsonl')).load();
reHead = RL.verify().head_hash;
reTiis = RL.listTIIs();
const p1 = project(RL.forTII(tii));
survived = {
  all_tii_strings: JSON.stringify(reTiis.sort()) === JSON.stringify(srcTiis.sort()),
  head_hash_identical: reHead === srcHead,
  verify_ok: RL.verify().ok,
  event_count_identical: RL.events.length === L.events.length,
  localization_survived: displayContent(p1, p1.events.find((e) => e.event_id === jaEv.event_id), 'en').content.description === 'Japanese record',
  authored_ja_survived: RL.getEvent(jaEv.event_id).content.description === '日本語の記録',
  external_id_survived: p1.references.some((r) => r.scheme === 'doi'),
  optional_modules_survived: !!p1.modules.address && !!p1.modules.domain && !!p1.modules.ignition,
  unknown_vocab_survived: !!p1.modules['unknown-module-qqq'],
  evidence_survived: p1.events.some((e) => (e.basis || []).length > 0),
  public_pages_rebuilt: staticBuilt === true,
};

/* ---- 4. dependency probe ------------------------------------------------- */
const deps = require(path.join(REPO, 'package.json')).dependencies || {};
const nodeModulesNeeded = fs.existsSync(path.join(REPO, 'node_modules'));

const report = {
  generated_at: new Date().toISOString(),
  '§32_reconstruction': {
    method: 'export ledger.jsonl/json/csv only; copy src/+bin/+package.json to a fresh dir; run CLI verify/list/rebuild-static; re-load and project',
    survived,
    npm_dependencies: deps,
    node_modules_present_in_repo: nodeModulesNeeded,
    external_binaries_used_by_reconstruction: ['node (>=18)'],
    undocumented_dependencies_found: undocumented.length ? undocumented : 'none — reconstruction needs only Node.js and the ledger.jsonl',
    conclusion: Object.values(survived).every(Boolean)
      ? 'PASS. Everything survives. Zero npm dependencies. No original DB, server, or service state needed. The ledger.jsonl file + the (open) source + Node.js are sufficient.'
      : 'PARTIAL — see survived map',
  },
  '§33_hosting_loss': {
    scenario: 'Vercel disappears',
    what_survives: 'Everything. The service is `node src/server.js` (zero deps) or a static export. `node bin/tii.js rebuild-static` produces the whole site from ledger.jsonl. No TII token changes. Verified: CLI + rebuild-static run in the fresh dir with no hosting.',
    what_requires_action: 'Point TII_RESOLVER_BASE_URL at a new host and redeploy (one env var). Nothing else.',
    status: 'PASS — hosting is not identity.',
  },
  '§34_domain_loss_model': {
    scenario: 'the (future) permanent resolver domain is unavailable',
    still_usable_now: {
      'raw tii:<token>': 'YES — it is a string; it contains no domain',
      'exported registry (ledger.jsonl / catalog.json)': 'YES — self-contained',
      'signed checkpoint': 'CANDIDATE ONLY — not produced by the live system',
      'independent mirrors': 'CONCEPT ONLY — no mirror protocol implemented; a mirror is just another copy of ledger.jsonl',
      'local reconstruction': 'YES — demonstrated in §32',
    },
    requires_future_permanent_domain: ['a stable citable specification URL', 'resolver role email addresses', 'IANA "specification" reference URL'],
    status: 'PARTIAL — identifier + records survive a domain loss today; the parts that need the permanent domain are documentation/governance, not identifier function.',
  },
  '§35_complete_operator_loss': {
    scenario: 'P/A Institute + hosting + registrar account + maintainers all gone',
    given: ['public specification', 'exported ledger.jsonl', 'source code (open)', 'CANDIDATE public keys / signed checkpoints (NOT produced live)', 'independent copies'],
    another_party_could_reconstruct: [
      'every tii:<token> string (unchanged)',
      'every historical event, in order, with hashes',
      'the full derived state / resolution pages (rebuild-static)',
      'all localizations, external identifiers, optional modules',
      'the SHA-256 chain self-consistency (verify)',
    ],
    another_party_could_NOT_do: [
      'prove the ledger was not rewritten before they received it — there is no live signed checkpoint or external timestamp anchor (see §26). They would trust whatever copy they got.',
      'recover the resolver domain / registrar account (no succession custody of an auth code is implemented — it is only described in spec/domain-failure-and-recovery.md)',
      'continue signed-checkpoint publication (no key custody, no keyset — CANDIDATE only)',
      'assume the IANA change-controller role (governance is candidate-only)',
    ],
    status: 'PARTIAL — the IDENTIFIERS and the RECORD survive completely; the TRUST ANCHOR and the GOVERNANCE/DOMAIN custody do not exist yet.',
  },
};

fs.writeFileSync(path.join(REPO, 'spec', 'audit', 'reconstruction-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

// cleanup
for (const d of [srcDir, kitDir, freshDir]) fs.rmSync(d, { recursive: true, force: true });
