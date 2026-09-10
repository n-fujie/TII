#!/usr/bin/env node
'use strict';

/**
 * §41 integrated capability demonstration — one test-only TII exercised through
 * as many live capabilities as possible, printed as a timeline.
 *   node spec/audit/demonstration.js
 * Isolated temp ledger. All identifiers are TEST identifiers.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(REPO + '/src/ledger');
const { project, displayContent } = require(REPO + '/src/projection');
const exporters = require(REPO + '/src/export');
const views = require(REPO + '/src/views');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-demo-'));
const L = new Ledger(path.join(dir, 'ledger.jsonl')).load();
const R = (id) => ({ id, kind: 'person' });
const steps = [];
const step = (label, ev) => steps.push({ seq: ev.seq, event_type: ev.event_type, module: (ev.content || {}).module || null, act: (ev.content || {}).act || null, by: ev.recorder.id, label });

const { tii, event: issued } = L.issueTII({ recorder: R('n-fujie'), content: { tracking_started_note: 'demonstration reference point' } });
step('issue test TII', issued);

const jaEv = L.append({ tii, event_type: 'interpretation.revised', recorder: R('n-fujie'), content: { module: 'interpretation', ref: 'what', description: 'この参照点は、ある分析対象の記述の変遷を追跡する', language: 'ja' } });
step('record Japanese description (interpretation)', jaEv);

step('add evidence reference', L.append({ tii, event_type: 'evidence.referenced', recorder: R('n-fujie'), content: { module: 'evidence', ref: 'e1', act: 'introduce', description: 'source document A' }, basis: ['file://doc-A', 'sha256:aaaa'] }));
step('add address (public location)', L.append({ tii, event_type: 'address.described', recorder: R('n-fujie'), content: { module: 'address', ref: 'a1', act: 'introduce', kind: 'public-location', value: 'https://host-1.example/x' } }));
step('add domain description', L.append({ tii, event_type: 'domain.described', recorder: R('n-fujie'), content: { module: 'domain', ref: 'd1', act: 'introduce', label: 'drafting scope', scope: 'not production' } }));
const ig = L.append({ tii, event_type: 'ignition.described', recorder: R('n-fujie'), content: { module: 'ignition', ref: 'ig1', act: 'introduce', what: 'distinction D became operative', under_conditions: 'condition set C' } });
step('record ignition interpretation', ig);
step('record transition interpretation', L.append({ tii, event_type: 'transition.described', recorder: R('n-fujie'), content: { module: 'transition', ref: 't1', act: 'introduce', relation_kind: 'precedes', from_ref: 'stage-0', to_ref: 'stage-1' } }));
step('add external identifier (DOI)', L.append({ tii, event_type: 'external.ref.added', recorder: R('n-fujie'), content: { module: 'external_identifier', ref: 'doi', act: 'introduce', scheme: 'doi', value: '10.9999/demo' } }));
step('add relation (stored-by)', L.append({ tii, event_type: 'relation.asserted', recorder: R('n-fujie'), content: { module: 'relation', ref: 'stores', act: 'introduce', relation_type: 'stores', subject: 'archive-X', object: 'this' } }));
step('add English translation of the ja interpretation', L.append({ tii, event_type: 'localization.added', recorder: R('translator'), content: { module: 'localization', ref: jaEv.event_id, source_event: jaEv.event_id, source_language: 'ja', target_language: 'en', kind: 'literal', translated_content: { description: 'This reference point tracks how the description of an object of analysis changed over time' } } }));
step('change address (host-1 stopped, host-2 introduced)', L.append({ tii, event_type: 'address.described', recorder: R('n-fujie'), content: { module: 'address', ref: 'a1', act: 'stop', reason: 'host-1 retired' } }));
L.append({ tii, event_type: 'address.described', recorder: R('n-fujie'), content: { module: 'address', ref: 'a2', act: 'introduce', kind: 'public-location', value: 'https://host-2.example/x' } });
step('contest the ignition interpretation', L.append({ tii, event_type: 'ignition.disputed', recorder: R('reviewer'), content: { module: 'ignition', ref: 'ig1', act: 'dispute', reason: 'condition set C not established' } }));
step('branch interpretation', L.append({ tii, event_type: 'branch.recorded', recorder: R('n-fujie'), content: { module: 'series', ref: 'br1', act: 'introduce', judgement: 'split', members: ['reading-1', 'reading-2'], reason: 'two incompatible readings' } }));
step('merge later interpretation', L.append({ tii, event_type: 'merge.recorded', recorder: R('n-fujie'), content: { module: 'series', ref: 'mg1', act: 'introduce', judgement: 'merge', members: ['reading-1', 'reading-2'], into: 'reading-3', reason: 'reconciled' } }));
step('record stewardship transfer description', L.append({ tii, event_type: 'stewardship.transferred', recorder: R('n-fujie'), content: { module: 'stewardship', ref: 'steward', act: 'replace', previous_steward: 'n-fujie', new_steward: 'successor-org', effective_at: '2027-01-01T00:00:00Z', evidence: ['doc://handover'] } }));
step('withdraw the transition classification', L.append({ tii, event_type: 'transition.withdrawn', recorder: R('n-fujie'), content: { module: 'transition', ref: 't1', act: 'withdraw', description: 'classifying stage-0→stage-1 as a transition was withdrawn' } }));

/* ---- verify / export / rebuild / reconstruct --------------------------- */
const v1 = L.verify();
const jsonl = exporters.toJSONL(L);
const out = path.join(dir, 'public');
exporters.buildStaticSite(L, out);
const bytesBefore = jsonl;
const bytesAfter = exporters.toJSONL(L);
const staticDidNotMutate = bytesBefore === bytesAfter;

const elsewhere = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tii-demo-else-')), 'ledger.jsonl');
fs.writeFileSync(elsewhere, jsonl);
const RL = new Ledger(elsewhere).load();
const p = project(RL.forTII(tii));

/* ---- what TII preserved ---------------------------------------------- */
const preserved = {
  identifier_unchanged: p.tii === tii,
  identifier_status: p.identifier_status,
  total_events: RL.events.length,
  every_event_retained: RL.events.length === L.events.length,
  original_issue_event_hash_unchanged: RL.getEvent(issued.event_id).hash === issued.hash,
  authored_japanese_still_there: RL.getEvent(jaEv.event_id).content.description === 'この参照点は、ある分析対象の記述の変遷を追跡する',
  english_projection: displayContent(p, p.events.find((e) => e.event_id === jaEv.event_id), 'en').content.description,
  japanese_projection_falls_back_to_authored: displayContent(p, p.events.find((e) => e.event_id === jaEv.event_id), 'ja').content.description === 'この参照点は、ある分析対象の記述の変遷を追跡する',
  ignition_present_and_disputed: !!p.modules.ignition && p.modules.ignition[0].disputed,
  transition_withdrawn: !!p.modules.transition && p.modules.transition[0].withdrawn && p.modules.transition[0].current === null,
  current_addresses: (p.modules.address || []).filter((b) => b.current).map((b) => b.current.content.value),
  old_address_in_history: (p.modules.address || []).find((b) => b.ref === 'a1').records.length === 2,
  external_ids: p.references.map((r) => `${r.scheme || r.source}:${r.value || ''}`),
  relations: (p.modules.relation || []).map((b) => b.ref),
  series_branch_and_merge_records: (p.modules.series || []).length,
  stewardship_records: (p.modules.stewardship || [{ records: [] }])[0].records.length,
  verify_ok_after_reconstruction: RL.verify().ok,
  head_hash_identical: RL.verify().head_hash === v1.head_hash,
  static_build_left_ledger_byte_identical: staticDidNotMutate,
};

console.log('=== §41 INTEGRATED DEMONSTRATION — timeline (all TEST) ===\n');
for (const s of steps) console.log(`  seq ${String(s.seq).padStart(2)}  ${s.event_type.padEnd(26)} ${(s.module || '').padEnd(16)} ${(s.act || '').padEnd(10)} by ${s.by.padEnd(11)} — ${s.label}`);
console.log('\n=== WHAT TII ACTUALLY PRESERVED (after export → reconstruct elsewhere) ===\n');
console.log(JSON.stringify(preserved, null, 2));

fs.writeFileSync(path.join(REPO, 'spec', 'audit', 'demonstration-timeline.json'), JSON.stringify({ generated_at: new Date().toISOString(), tii, identifier_status: p.identifier_status, timeline: steps, preserved }, null, 2) + '\n');
console.log('\nwrote spec/audit/demonstration-timeline.json');

for (const d of [dir]) fs.rmSync(d, { recursive: true, force: true });
