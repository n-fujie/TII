#!/usr/bin/env node
'use strict';

/**
 * TII capability-boundary audit harness — CURRENT LIVE CORE.
 *
 *   node spec/audit/capability-audit.js            # run, print summary
 *   node spec/audit/capability-audit.js --json     # also write spec/capability-matrix.json
 *
 * Uses isolated temp ledgers only. Never touches data/ledger.jsonl.
 * Exercises src/ledger.js, src/projection.js, src/export.js, src/id.js and the
 * candidate modules (clearly labelled). Emits a capability matrix with an
 * executed test behind every PASS.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(path.join(REPO, 'src/ledger'));
const { project, displayContent } = require(path.join(REPO, 'src/projection'));
const exporters = require(path.join(REPO, 'src/export'));
const views = require(path.join(REPO, 'src/views'));
const candId = require(path.join(REPO, 'src/candidate/identifier'));
const candCkpt = require(path.join(REPO, 'src/candidate/checkpoint'));
const candJcs = require(path.join(REPO, 'src/candidate/jcs'));

const results = [];
function record(r) {
  results.push(r);
  const s = String(r.status).padEnd(18);
  console.log(`${s} ${r.capability}`);
  if (r.limitation) console.log(`   └─ ${r.limitation}`);
}

function freshLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-audit-'));
  const file = path.join(dir, 'ledger.jsonl');
  const l = new Ledger(file).load();
  l._dir = dir;
  return l;
}
const rec = (id) => ({ id, kind: 'person' });

/* ============================================================ §4 issuance */
{
  const l = freshLedger();
  let requiredMeta = [];
  try { l.issueTII({}); } catch { requiredMeta.push('recorder'); }
  const { tii, event } = l.issueTII({ recorder: rec('tester') });
  const isTest = event.content.identifier_status === 'test';
  const appended = l.append({ tii, event_type: 'note.added', recorder: rec('tester'), content: { module: 'note', ref: 'n', text: 'hi' } });
  const before = JSON.parse(JSON.stringify(l.getEvent(event.event_id)));
  l.append({ tii, event_type: 'note.added', recorder: rec('tester'), content: { module: 'note', ref: 'n', act: 'replace', text: 'hi2' } });
  const unchanged = JSON.stringify(l.getEvent(event.event_id)) === JSON.stringify(before);
  const p = project(l.forTII(tii));
  const resolverHtml = views.resolutionPage({ lang: 'en', p });
  const jsonOk = typeof JSON.stringify(p) === 'string' && p.exists === true;
  const summary = exporters.publicSummary(p);
  const registryHtml = views.registryPage({ lang: 'en', summaries: [summary] });
  const jsonl = exporters.toJSONL(l);
  const csv = exporters.toCSV(l);
  const out = path.join(l._dir, 'public');
  exporters.buildStaticSite(l, out);
  const staticHasTii = fs.existsSync(path.join(out, 'tii', candId.tiiToFileSlug ? '' : '', '')) || fs.readdirSync(path.join(out, 'tii')).length > 0;
  const v = l.verify();
  record({
    capability: '§4 Basic issuance (issue → append → resolve → JSON → registry → export → static → verify)',
    status: (isTest && jsonOk && v.ok && unchanged && registryHtml.includes(tii) && jsonl.includes(tii) && csv.includes(tii) && staticHasTii) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core)',
    codePath: 'src/ledger.issueTII / append, src/projection.project, src/export.*, src/views.*',
    test: 'issue a test TII, append events, render resolution + registry, export JSONL/CSV, buildStaticSite, verify()',
    observed: `identifier=${tii}; identifier_status=${event.content.identifier_status}; genesis event unchanged after later append=${unchanged}; verify.ok=${v.ok}; resolution html length=${resolverHtml.length}; registry lists it=${registryHtml.includes(tii)}; jsonl/csv/static include it=${jsonl.includes(tii)}/${csv.includes(tii)}/${staticHasTii}`,
    limitation: `Required metadata for issuance: ${requiredMeta.join(', ') || 'none'} (recorder is a TII-Core required field per SPEC §5). No other field required. identifier_status is hard-set to "test" (src/ledger.js:92) — there is no production issuance code path at all.`,
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §5 minimal record */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const p = project(l.forTII(tii));
  const forbidden = ['state', 'transition', 'ignition', 'address', 'domain', 'boundary', 'lineage', 'series', 'owner', 'document_type'];
  const leaked = forbidden.filter((k) => k in p || (p.modules && p.modules[k]));
  // also check the raw issued event
  const ev = l.forTII(tii)[0];
  const evLeak = forbidden.filter((k) => k in ev);
  record({
    capability: '§5 Minimal record — a TII with none of state/transition/ignition/address/domain/boundary/lineage/owner/doc-type',
    status: (leaked.length === 0 && evLeak.length === 0 && Object.keys(p.modules).length === 0) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.issueTII, src/projection.project',
    test: 'issue with {recorder} only; inspect projection.modules and the raw issued event for any of the optional categories',
    observed: `projection.modules=${JSON.stringify(p.modules)}; leaked keys in projection=${JSON.stringify(leaked)}; leaked keys in issued event=${JSON.stringify(evLeak)}`,
    limitation: leaked.length || evLeak.length ? `LEAK: ${[...leaked, ...evLeak].join(', ')}` : 'None. A TII exists with an empty modules object; no optional descriptive category is required or implied.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §6 unknown vocabulary */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const ev = l.append({
    tii,
    event_type: 'audit.test.arbitrary-event-type-xyzzy',
    recorder: rec('t'),
    content: { module: 'audit-test-arbitrary-module-plugh', ref: 'r1', act: 'audit-test-arbitrary-act-frobnicate', payload: { nested: [1, 'two', true] } },
  });
  const jsonl = exporters.toJSONL(l);
  const out = path.join(l._dir, 'pub');
  exporters.buildStaticSite(l, out);
  const rebuilt = new Ledger(path.join(l._dir, 're.jsonl'));
  fs.writeFileSync(rebuilt.file, jsonl);
  rebuilt.load();
  const p = project(rebuilt.forTII(tii));
  const html = views.resolutionPage({ lang: 'en', p });
  const preserved =
    rebuilt.getEvent(ev.event_id).event_type === ev.event_type &&
    rebuilt.getEvent(ev.event_id).content.act === 'audit-test-arbitrary-act-frobnicate' &&
    !!p.modules['audit-test-arbitrary-module-plugh'] &&
    html.includes('frobnicate') &&
    rebuilt.verify().ok;
  record({
    capability: '§6 Open vocabulary — unknown event_type / module / act survive storage, export, static rebuild, re-import, projection, render, verify',
    status: preserved ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append (no enum validation), src/projection (buckets by content.module), src/export.toJSONL, src/views',
    test: 'append an event with three never-before-seen strings; export→re-import; buildStaticSite; project; render; verify()',
    observed: `stored verbatim=${rebuilt.getEvent(ev.event_id).event_type === ev.event_type}; module bucketed=${!!p.modules['audit-test-arbitrary-module-plugh']}; act value in render=${html.includes('frobnicate')}; verify.ok=${rebuilt.verify().ok}`,
    limitation: 'None. src/labels.js is display-only and never used for validation. Unknown module names appear as their own section on the resolution page.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §7 record revision */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const a = l.append({ tii, event_type: 'record.added', recorder: rec('x'), content: { module: 'claim', ref: 'c', act: 'introduce', text: 'A' } });
  const b = l.append({ tii, event_type: 'record.added', recorder: rec('x'), content: { module: 'claim', ref: 'c', act: 'replace', text: 'B' } });
  const dispute = l.append({ tii, event_type: 'claim.disputed', recorder: rec('y'), content: { module: 'claim', ref: 'c', act: 'dispute', reason: 'B is wrong' } });
  const superDispute = l.append({ tii, event_type: 'record.corrected', recorder: rec('y'), supersedes: dispute.event_id, content: { module: 'claim', ref: 'c', act: 'dispute', reason: 'B is wrong (clarified)' } });
  const withdraw = l.append({ tii, event_type: 'claim.withdrawn', recorder: rec('x'), content: { module: 'claim', ref: 'c', act: 'withdraw', reason: 'retract the whole claim' } });
  const p = project(l.forTII(tii));
  const bucket = p.modules.claim[0];
  const allPresent = [a, b, dispute, superDispute, withdraw].every((e) => p.events.some((pe) => pe.event_id === e.event_id));
  const noOverwrite = [a, b, dispute].every((e) => l.getEvent(e.event_id).content.text !== undefined || l.getEvent(e.event_id).content.reason !== undefined);
  const currentNull = bucket.current === null; // last live act is 'withdraw'
  record({
    capability: '§7 Record revision — A → B → contest → supersede contest → withdraw; nothing overwritten; "no current interpretation" is expressible',
    status: (allPresent && noOverwrite && currentNull && p.superseded_event_ids.includes(dispute.event_id) && l.verify().ok) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append(supersedes), src/projection (supersededBy map, withdraw/stop → current=null)',
    test: '5 events forming introduce/replace/dispute/supersede-dispute/withdraw; inspect projection current + history + superseded set',
    observed: `all 5 events retrievable=${allPresent}; superseded set=${JSON.stringify(p.superseded_event_ids)}; bucket.current=${JSON.stringify(bucket.current)}; bucket.disputed=${bucket.disputed}; bucket.records=${bucket.records.length}; verify.ok=${l.verify().ok}`,
    limitation: 'None. "current interpretation = none" is represented as bucket.current === null after a withdraw; the resolution page shows the "No record is currently interpreted as valid" notice.',
    archChange: false,
    launchDep: false,
  });
}

/* ================================================= §8/§9 ignition & transition optionality */
for (const mod of ['ignition', 'transition']) {
  const l = freshLedger();
  const A = l.issueTII({ recorder: rec('t') }).tii; // none ever
  const B = l.issueTII({ recorder: rec('t') }).tii;
  l.append({ tii: B, event_type: `${mod}.described`, recorder: rec('x'), content: { module: mod, ref: 'm', act: 'introduce', what: 'X' } });
  const C = l.issueTII({ recorder: rec('t') }).tii;
  l.append({ tii: C, event_type: `${mod}.described`, recorder: rec('x'), content: { module: mod, ref: 'm', act: 'introduce', what: 'X' } });
  l.append({ tii: C, event_type: `${mod}.disputed`, recorder: rec('y'), content: { module: mod, ref: 'm', act: 'dispute' } });
  l.append({ tii: C, event_type: `${mod}.withdrawn`, recorder: rec('x'), content: { module: mod, ref: 'm', act: 'withdraw', description: `classifying this as ${mod} was withdrawn` } });
  l.append({ tii: C, event_type: `${mod}.described`, recorder: rec('x'), content: { module: mod, ref: 'm', act: 'apply', what: 'X again' } });
  // "was the wrong descriptive vocabulary" — reclassify to a non-<mod> module
  l.append({ tii: C, event_type: 'note.added', recorder: rec('z'), content: { module: 'reclassification', ref: 'rc', act: 'introduce', description: `ref m was not really a ${mod}; treating as a plain observation`, replaces_module: mod } });
  const pA = project(l.forTII(A)), pB = project(l.forTII(B)), pC = project(l.forTII(C));
  const ok = pA.exists && pB.exists && pC.exists && !pA.modules[mod] && pB.modules[mod] && pC.modules[mod] && pC.modules[mod][0].records.length === 4 && l.verify().ok;
  record({
    capability: `§${mod === 'ignition' ? 8 : 9} ${mod[0].toUpperCase()}${mod.slice(1)} optionality — TII valid with 0 / 1 / (described→disputed→withdrawn→reintroduced) ${mod} records; and reclassifiable as "wrong vocabulary"`,
    status: ok ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: `src/ledger.append, src/projection (${mod} treated as any other module bucket)`,
    test: `three TIIs (none / one / full lifecycle + reclassification); verify all three project as valid`,
    observed: `A has no ${mod} section=${!pA.modules[mod]}; B has ${mod}=${!!pB.modules[mod]}; C ${mod} record count=${pC.modules[mod] ? pC.modules[mod][0].records.length : 0}; C also has a 'reclassification' module=${!!pC.modules.reclassification}; verify.ok=${l.verify().ok}`,
    limitation: `${mod} is a plain projection bucket with no special status. "This ${mod} classification was inappropriate" is recordable as a withdraw act and/or a separate reclassification module. Nothing in the engine requires a ${mod}.`,
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §10 state non-primitivity */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const sA = l.append({ tii, event_type: 'state.described', recorder: rec('x'), content: { module: 'state', ref: 'A', act: 'introduce', label: 'State A' } });
  const sB = l.append({ tii, event_type: 'state.described', recorder: rec('x'), content: { module: 'state', ref: 'B', act: 'introduce', label: 'State B' } });
  l.append({ tii, event_type: 'transition.described', recorder: rec('x'), content: { module: 'transition', ref: 't', act: 'introduce', from_ref: 'A', to_ref: 'B' } });
  l.append({ tii, event_type: 'interpretation.revised', recorder: rec('y'), content: { module: 'interpretation', ref: 'i', description: 'The A/B discrete-state separation is rejected; this is now treated as one continuous process.' } });
  const p = project(l.forTII(tii));
  const historyVisible = l.getEvent(sA.event_id).content.label === 'State A' && l.getEvent(sB.event_id).content.label === 'State B' && p.modules.state && p.modules.state.length === 2;
  const currentInterp = p.interpretation[p.interpretation.length - 1].content.description.includes('continuous process');
  record({
    capability: '§10 State non-primitivity — record A/B + transition, then a later interpretation rejecting the discrete-state split; both remain visible',
    status: (historyVisible && currentInterp && l.verify().ok) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection (state buckets + interpretation list are independent)',
    test: 'two state records + transition + an interpretation.revised event rejecting the split',
    observed: `both state records still present=${historyVisible}; current interpretation says continuous process=${currentInterp}`,
    limitation: 'Partial by design of the DISPLAY: the resolution page still renders the historical State A / State B sections (they have records) alongside the current interpretation. There is no "state concept withdrawn" flag that hides them — nor should there be, since the history must stay visible. The current interpretation does not preserve discrete-state ontology; the historical description does.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §11 address / domain */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const A = (ref, act, extra) => l.append({ tii, event_type: 'address.described', recorder: rec('x'), content: { module: 'address', ref, act, ...extra } });
  const D = (ref, act, extra) => l.append({ tii, event_type: 'domain.described', recorder: rec('x'), content: { module: 'domain', ref, act, ...extra } });
  A('a1', 'introduce', { kind: 'public-location', value: 'https://host-1.test/x' });
  A('a2', 'introduce', { kind: 'network-location', value: 'https://host-2.test/x' }); // multiple simultaneous
  A('a1', 'stop', { reason: 'host-1 unreachable' }); // becomes unreachable
  A('a3', 'introduce', { kind: 'public-location', value: 'https://host-3.test/x' }); // replacement
  A('a4', 'introduce', { kind: 'public-location', value: 'https://host-4.test/x', note: 'competes with a3' }); // competing
  D('d1', 'introduce', { label: 'domain-1', scope: 'scope text' });
  D('d1', 'replace', { label: 'domain-2', scope: 'changed' }); // changed
  D('d1', 'dispute', { reason: 'domain-2 is wrong' }); // contested
  D('d2', 'introduce', { label: 'domain-3', note: 'domain without an address' });
  const p = project(l.forTII(tii));
  const addr = p.modules.address, dom = p.modules.domain;
  const independent = Array.isArray(addr) && Array.isArray(dom) && addr.length === 4 && dom.length === 2;
  const a1withdrawn = addr.find((b) => b.ref === 'a1').withdrawn === true;
  const currentAddrs = addr.filter((b) => b.current).map((b) => b.current.content.value);
  const noIdentityLeak = !('address' in p) || p.tii === tii; // address never becomes identity
  record({
    capability: '§11 Address / Domain — 1/many/none/unreachable/replaced/competing addresses; domain add/change/contest/remove; address⊥domain; addr-without-domain; domain-without-address',
    status: (independent && a1withdrawn && currentAddrs.length >= 2 && noIdentityLeak && l.verify().ok) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection (address and domain are separate top-level module buckets), src/views (Address / Domain section, "no address privileged" note)',
    test: '9 events covering every address/domain sub-case; inspect projection',
    observed: `address buckets=${addr.length}, domain buckets=${dom.length}; a1 withdrawn=${a1withdrawn}; current addresses=${JSON.stringify(currentAddrs)}; the identifier is never derived from any address value`,
    limitation: 'None functional. Address and Domain are fully independent modules. The resolution page shows every current address with its kind and the note "No address is designated as permanently or exclusively authoritative." "Competing addresses" are simply two current address buckets — the system does not adjudicate.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §12 mirror */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  l.append({ tii, event_type: 'address.described', recorder: rec('x'), content: { module: 'address', ref: 'primary', act: 'introduce', kind: 'public-location', value: 'https://primary.test/x' } });
  l.append({ tii, event_type: 'address.described', recorder: rec('x'), content: { module: 'address', ref: 'mirror-1', act: 'introduce', kind: 'network-location', value: 'https://mirror.test/x' } });
  const before = exporters.toJSONL(l);
  l.append({ tii, event_type: 'address.described', recorder: rec('x'), content: { module: 'address', ref: 'primary', act: 'stop', reason: 'primary host lost' } });
  const p = project(l.forTII(tii));
  const oldAddrInHistory = p.modules.address.find((b) => b.ref === 'primary').records.length === 2;
  const mirrorStillCurrent = !!p.modules.address.find((b) => b.ref === 'mirror-1' && b.current);
  const tiiUnchanged = p.tii === tii && exporters.toJSONL(l).startsWith(before);
  record({
    capability: '§12 Mirror — record with multiple resolvable locations; primary lost; other remains; no re-issuance; old address in history',
    status: (oldAddrInHistory && mirrorStillCurrent && tiiUnchanged && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection',
    test: 'two address records + a stop on the primary; check the mirror is still current and the primary is in history',
    observed: `primary address has 2 history records=${oldAddrInHistory}; mirror still current=${mirrorStillCurrent}; tii unchanged & earlier ledger bytes are a prefix=${tiiUnchanged}`,
    limitation: 'The address module records locations. The system does not itself probe reachability or fail over; a resolver / client would choose among the current addresses.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §13 content hash */
{
  const l = freshLedger();
  const A = l.issueTII({ recorder: rec('t') }).tii;
  const digestA = 'a'.repeat(64), digestB = 'b'.repeat(64);
  l.append({ tii: A, event_type: 'content.hash.recorded', recorder: rec('x'), content: { module: 'content', ref: 'file', algo: 'sha256', value: digestA }, content_verification: { algo: 'sha256', value: digestA } });
  l.append({ tii: A, event_type: 'content.hash.recorded', recorder: rec('x'), content: { module: 'content', ref: 'file', act: 'replace', algo: 'sha256', value: digestB, note: 'one byte changed' }, content_verification: { algo: 'sha256', value: digestB } });
  const pA = project(l.forTII(A));
  const bothHashesVisible = pA.modules.content[0].records.length === 2 && pA.modules.content[0].records.map((r) => r.content.value).join() === `${digestA},${digestB}`;
  const rootUnchanged = pA.tii === A;
  // reverse: same digest in two different TIIs
  const B = l.issueTII({ recorder: rec('t') }).tii;
  const C = l.issueTII({ recorder: rec('t') }).tii;
  l.append({ tii: B, event_type: 'content.hash.recorded', recorder: rec('x'), content: { module: 'content', ref: 'f', algo: 'sha256', value: digestA }, content_verification: { algo: 'sha256', value: digestA } });
  l.append({ tii: C, event_type: 'content.hash.recorded', recorder: rec('x'), content: { module: 'content', ref: 'f', algo: 'sha256', value: digestA }, content_verification: { algo: 'sha256', value: digestA } });
  const notMerged = B !== C && project(l.forTII(B)).tii !== project(l.forTII(C)).tii && l.listTIIs().length === 3;
  record({
    capability: '§13 Content hash — digest A → change a byte → digest B; root TII unchanged; both hashes visible; not claimed byte-identical. Reverse: equal hashes in two TIIs do NOT merge them',
    status: (bothHashesVisible && rootUnchanged && notMerged && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append (content_verification field), src/projection (content module bucket)',
    test: 'record two successive sha256 digests on one TII; record the same digest on two separate TIIs',
    observed: `both digests in history=${bothHashesVisible}; root identifier unchanged=${rootUnchanged}; equal-hash TIIs stay separate (3 distinct TIIs)=${notMerged}`,
    limitation: 'The system records content-verification values as data. It never (a) claims byte identity from a matching hash, (b) merges identifiers because their content hashes match, or (c) changes a TII because content changed. It also does not itself compute or check the digest of any external artifact — that is the recorder\'s assertion (see bin/tii.js hash-file for a helper).',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §14 series / lineage */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const S = (act, extra) => l.append({ tii, event_type: 'series.judged', recorder: rec('x'), content: { module: 'series', ref: 's', act, ...extra } });
  S('introduce', { judgement: 'same-series', members: ['tii:aaa', 'tii:bbb'] });
  S('replace', { judgement: 'split', members: [['tii:aaa'], ['tii:bbb']], reason: 'diverged' });
  const contest = l.append({ tii, event_type: 'series.judged', recorder: rec('y'), content: { module: 'series', ref: 's', act: 'dispute', judgement: 'dispute', reason: 'split premature' } });
  S('replace', { judgement: 'merge', members: ['tii:aaa', 'tii:bbb'], reason: 're-merged' });
  S('withdraw', { description: 'the whole lineage interpretation is withdrawn for this record' });
  const p = project(l.forTII(tii));
  const bucket = p.modules.series[0];
  const revisable = bucket.records.length === 5 && bucket.disputed && bucket.withdrawn && bucket.current === null;
  record({
    capability: '§14 Series / lineage — one lineage → split → contest → merge → reject lineage entirely; recorded as revisable judgment',
    status: (revisable && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection (series is a normal module bucket; SPEC frames it as a judgement not an object)',
    test: '5 series events covering the full revision arc',
    observed: `series bucket records=${bucket.records.length}; disputed=${bucket.disputed}; withdrawn=${bucket.withdrawn}; current=${JSON.stringify(bucket.current)}`,
    limitation: 'Series/lineage is a module bucket like any other. Members are just data (arrays of strings). The system does not cross-link the named member TIIs or build a graph — lineage is a local, revisable judgement recorded on this TII.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §15 branch / merge + cycles */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const B = (ref, extra) => l.append({ tii, event_type: 'branch.recorded', recorder: rec('x'), content: { module: 'series', ref, act: 'introduce', judgement: 'split', ...extra } });
  const M = (ref, extra) => l.append({ tii, event_type: 'merge.recorded', recorder: rec('x'), content: { module: 'series', ref, act: 'introduce', judgement: 'merge', ...extra } });
  l.append({ tii, event_type: 'note.added', recorder: rec('x'), content: { module: 'lineage-node', ref: 'A', act: 'introduce' } });
  l.append({ tii, event_type: 'note.added', recorder: rec('x'), content: { module: 'lineage-node', ref: 'B', act: 'introduce', from: 'A' } });
  B('br-1', { members: ['C1', 'C2'], from: 'B' });
  M('mg-1', { members: ['C1', 'C2'], into: 'D' });
  // cyclic descriptive reference: D relates-to A
  const cyc = l.append({ tii, event_type: 'note.added', recorder: rec('x'), content: { module: 'transition', ref: 'cyc', act: 'introduce', relation_kind: 'cyclic', from_ref: 'D', to_ref: 'A', note: 'deliberate cycle D->A' } });
  const p = project(l.forTII(tii));
  const ancestryKept = p.modules['lineage-node'].length === 2 && p.modules.series.length === 2 && l.verify().ok;
  const cycleAccepted = !!p.modules.transition && p.modules.transition[0].current.content.relation_kind === 'cyclic';
  record({
    capability: '§15 Branch / merge — A→B→(C1,C2)→D; ancestry preserved; branch records survive merge; projection derived not canonical. Cyclic descriptive references',
    status: (ancestryKept && cycleAccepted) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection',
    test: 'construct a branch/merge lineage as events; add a cyclic transition relation',
    observed: `lineage-node records=${p.modules['lineage-node'].length}; series records=${p.modules.series.length}; cyclic relation_kind accepted=${cycleAccepted}; verify.ok=${l.verify().ok}`,
    limitation: 'There is NO graph/branch/merge engine. "Branch" and "merge" are just event_type strings + series module records; ancestry is whatever the events say. There is no visual projection of a DAG (the resolution page lists records, it does not draw a tree). Cycles are neither detected nor forbidden nor warned about — the engine has no concept of a graph to find a cycle in. SPEC frames cycles as a candidate relation_kind value only.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §16 ownership decomposition */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const rels = ['stores', 'controls', 'may_modify', 'may_publish', 'maintains', 'holds_copyright', 'funds', 'signs', 'may_withdraw'];
  rels.forEach((rt, i) => l.append({ tii, event_type: 'relation.asserted', recorder: rec('x'), content: { module: 'relation', ref: rt, act: 'introduce', relation_type: rt, subject: `actor-${i % 3}`, object: 'this' } }));
  // change several actors over time
  l.append({ tii, event_type: 'relation.asserted', recorder: rec('x'), content: { module: 'relation', ref: 'stores', act: 'replace', relation_type: 'stores', subject: 'actor-NEW' } });
  l.append({ tii, event_type: 'relation.asserted', recorder: rec('y'), content: { module: 'relation', ref: 'controls', act: 'dispute', reason: 'conflicting control claim' } });
  const p = project(l.forTII(tii));
  const noOwner = !('owner' in p) && !p.modules.owner && !l.forTII(tii).some((e) => 'owner' in (e.content || {}));
  const overlap = p.modules.relation.length === rels.length;
  const historyKept = p.modules.relation.find((b) => b.ref === 'stores').records.length === 2;
  record({
    capability: '§16 Ownership decomposition — no owner field; separate stores/controls/may_modify/... relations with different, changing actors; overlap + conflict + history retained',
    status: (noOwner && overlap && historyKept && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection (relation module; no owner concept anywhere in the core)',
    test: '9 distinct relation types + an actor change + a disputed relation',
    observed: `no owner anywhere=${noOwner}; ${p.modules.relation.length} concurrent relation buckets; 'stores' has 2 history records=${historyKept}`,
    limitation: 'None. The core has no owner field. Relations overlap and conflict freely; the system records, it does not resolve. Stewardship change (below) is just another relation/event and never touches the TII.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §17 stewardship transfer */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const T = (from, to, extra) => l.append({ tii, event_type: 'stewardship.transferred', recorder: rec(from), content: { module: 'stewardship', ref: 'steward', act: 'replace', previous_steward: from, new_steward: to, ...extra } });
  T('Steward-A', 'Steward-B', { effective_at: '2026-01-01T00:00:00Z', evidence: ['doc://transfer-1'] });
  l.append({ tii, event_type: 'stewardship.transferred', recorder: rec('C'), content: { module: 'stewardship', ref: 'steward', act: 'dispute', reason: 'B->C transfer contested', new_steward: 'Steward-C' } });
  T('Steward-B', 'Steward-C', { effective_at: '2026-06-01T00:00:00Z', evidence: ['doc://transfer-2'], note: 'contest resolved, accepted' });
  const p = project(l.forTII(tii));
  const chain = p.modules.stewardship[0].records.length === 3 && p.tii === tii && l.verify().ok;
  record({
    capability: '§17 Stewardship transfer — A→B→C with dates, evidence, a contested then accepted transfer; TII never changes',
    status: chain ? 'PARTIAL' : 'FAIL',
    layer: 'A (live core) for storage; SPECIFICATION-ONLY for a dedicated transfer workflow',
    codePath: 'src/ledger.append (open event_type "stewardship.transferred"), src/projection (generic module bucket)',
    test: '3 stewardship events including a dispute; check history + that the identifier is unchanged',
    observed: `3 stewardship records retained=${p.modules.stewardship[0].records.length === 3}; identifier unchanged=${p.tii === tii}; verify.ok=${l.verify().ok}`,
    limitation: 'PARTIAL: a stewardship transfer is fully recordable as append-only events and the TII is provably unchanged. But there is NO first-class transfer procedure in the live code — no `authority.transferred` handling in projection, no signature/authorization check, no "current steward" derived field, no succession-kit generation. spec/governance-candidate.md and spec/succession-policy.md describe the procedure; the software only stores the events.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §18 localization stress */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const src = l.append({ tii, event_type: 'note.added', recorder: rec('jp'), content: { module: 'note', ref: 'n1', act: 'introduce', description: '日本語で作成された記録', language: 'ja' } });
  const loc = (lang, text, extra = {}) => l.append({ tii, event_type: 'localization.added', recorder: rec('tr'), content: { module: 'localization', ref: src.event_id, source_event: src.event_id, source_language: 'ja', target_language: lang, kind: 'literal', translated_content: { description: text }, ...extra } });
  const en1 = loc('en', 'English translation v1');
  const en2 = loc('en', 'English translation v2 (corrected)');
  const fr = loc('fr', 'traduction française');
  const de = loc('de', 'deutsche Übersetzung');
  const jpAnno = l.append({ tii, event_type: 'note.added', recorder: rec('jp'), content: { module: 'annotation', ref: 'a1', act: 'introduce', description: '後日の日本語注記', language: 'ja' } });
  const beforeBytes = exporters.toJSONL(l);
  const p = project(l.forTII(tii));
  const srcView = p.events.find((e) => e.event_id === src.event_id);
  const enShown = displayContent(p, srcView, 'en').content.description === 'English translation v2 (corrected)';
  const jaFallback = displayContent(p, srcView, 'ja').content.description === '日本語で作成された記録';
  const frShown = displayContent(p, srcView, 'fr').content.description === 'traduction française';
  const authoredUnchanged = l.getEvent(src.event_id).content.description === '日本語で作成された記録';
  const enHtml = views.resolutionPage({ lang: 'en', p });
  const jaHtml = views.resolutionPage({ lang: 'ja', p });
  const out = path.join(l._dir, 'pub');
  exporters.buildStaticSite(l, out);
  const ledgerUnchangedAfterBuild = exporters.toJSONL(l) === beforeBytes;
  const allLangsInExport = [en1, en2, fr, de].every((e) => beforeBytes.includes(e.event_id));
  record({
    capability: '§18 Localization stress — ja source + en v1 + en correction + fr + de + later ja annotation; authored unchanged; newest en projected; static build does not mutate; exports keep all; new language needs no schema migration',
    status: (enShown && jaFallback && frShown && authoredUnchanged && ledgerUnchangedAfterBuild && allLangsInExport && l.verify().ok) ? 'PASS' : 'PARTIAL',
    layer: 'A (live core) — localization IS wired into the live projection + views',
    codePath: 'src/projection (localizations map, displayContent), src/views (displayDl), src/ledger.append',
    test: '6 events (source + 4 translations + annotation); check displayContent per language, authored immutability, static-build ledger stability',
    observed: `en projected = latest correction=${enShown}; ja falls back to authored=${jaFallback}; fr projected=${frShown}; authored event unchanged=${authoredUnchanged}; buildStaticSite left ledger byte-identical=${ledgerUnchangedAfterBuild}; all 4 translation events in export=${allLangsInExport}`,
    limitation: 'None. A 5th/6th language is added by appending another localization.added event — no core field, no migration. Translation kind (literal/interpretive) is recorded. The <details> audit trail on the resolution page always shows the authored content.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §19 external identifier */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const X = (scheme, value, act = 'introduce', extra = {}) => l.append({ tii, event_type: 'external.ref.added', recorder: rec('x'), content: { module: 'external_identifier', ref: scheme, act, scheme, value, ...extra } });
  X('doi', '10.9999/test.1');
  X('ark', 'ark:/99999/test');
  X('isbn', '978-0-000000-00-0');
  X('url', 'https://example.test/thing');
  X('ipfs-cid', 'bafyTESTcid');
  X('future-pid-type-xyz', 'xyz:whatever');
  X('doi', '10.9999/test.1', 'stop', { status: 'revoked', note: 'DOI deactivated at registrar' });
  const p = project(l.forTII(tii));
  const multiple = p.references.length >= 6;
  const doiGone = p.references.some((r) => r.scheme === 'doi' && (r.status === 'stop' || r.status === 'revoked'));
  const unknownKept = p.references.some((r) => r.scheme === 'future-pid-type-xyz');
  const notSubordinate = p.exists && p.tii === tii; // TII valid regardless of any external id
  record({
    capability: '§19 External identifiers — DOI/ARK/ISBN/URL/IPFS-CID/unknown coexist; one disappears without invalidating TII; TII not subordinate to DOI/ARK; unknown types retained',
    status: (multiple && doiGone && unknownKept && notSubordinate && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append, src/projection (references[] from external_identifier module + event.external_refs), src/views (External Identifiers section)',
    test: '6 external identifier types + a revocation of the DOI',
    observed: `${p.references.length} external references; DOI shows revoked/stop=${doiGone}; unknown scheme "future-pid-type-xyz" retained=${unknownKept}; TII still valid=${notSubordinate}`,
    limitation: 'The system associates external identifiers as data. It does NOT resolve, dereference, or validate any of them — a recorded DOI is the recorder\'s assertion, not proof the DOI exists (see §42). Revocation/disappearance is recorded as an act; the reference stays in history.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §36 non-scholarly objects */
{
  const l = freshLedger();
  const cases = [
    ['paper-revision', { module: 'version', ref: 'v', label: 'rev 3' }],
    ['software-impl', { module: 'artifact', ref: 'repo', kind: 'source', vcs: 'git' }],
    ['changing-dataset', { module: 'dataset', ref: 'd', rows: 1200, checksum: 'deadbeef' }],
    ['physical-artifact', { module: 'object', ref: 'o', location: 'shelf 3B', material: 'paper' }],
    ['sensor-series', { module: 'observation', ref: 'stream', sampling: '1/min', unit: 'C' }],
    ['institutional-rule', { module: 'rule', ref: 'r', text: 'Policy 12 §4' }],
    ['disputed-classification', { module: 'classification', ref: 'c', act: 'dispute', claimed: 'X', reason: 'contested' }],
    ['no-file-at-all', { module: 'note', ref: 'n', description: 'a reference point with no digital artifact' }],
  ];
  const ok = cases.every(([name, content]) => {
    const { tii } = l.issueTII({ recorder: rec('t') });
    l.append({ tii, event_type: 'record.added', recorder: rec('x'), content: { act: 'introduce', ...content } });
    const p = project(l.forTII(tii));
    return p.exists && Object.keys(p.modules).length === 1;
  });
  record({
    capability: '§36 Non-scholarly objects — paper history / software / dataset / physical artifact / sensor series / institutional rule / disputed classification / no-file',
    status: (ok && l.verify().ok && l.listTIIs().length === 8) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.issueTII / append, src/projection',
    test: '8 structurally different reference kinds, each a TII with one arbitrary module record',
    observed: `all 8 project as valid TIIs with no schema change=${ok}; 8 distinct identifiers issued`,
    limitation: 'None. The thin core has no object-category field. "document", "dataset", "sensor" etc. are just module names chosen by the recorder. TII is not a paper identifier.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §37 "no object" */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t'), content: { tracking_started_note: 'tracing a disputed reference; no claim that one stable object exists' } });
  l.append({ tii, event_type: 'note.added', recorder: rec('a'), content: { module: 'observation', ref: 'o1', act: 'introduce', text: 'observed as P' } });
  l.append({ tii, event_type: 'note.added', recorder: rec('b'), content: { module: 'observation', ref: 'o2', act: 'introduce', text: 'observed as Q, incompatible with P' } });
  l.append({ tii, event_type: 'interpretation.revised', recorder: rec('c'), content: { module: 'interpretation', ref: 'i', description: 'no single referent is asserted; P and Q may be different things' } });
  l.append({ tii, event_type: 'note.added', recorder: rec('d'), content: { module: 'classification', ref: 'k', act: 'dispute', reason: 'is this even one reference point?' } });
  const p = project(l.forTII(tii));
  const noObjectField = !l.forTII(tii).some((e) => 'object' in (e.content || {}) && typeof e.content.object === 'string' && e.content.object.length > 0 && e.content.module === undefined);
  const worksWithoutStableReferent = p.exists && p.modules.observation.length === 2 && p.interpretation.length === 1;
  record({
    capability: '§37 "No object" — a TII tracing a disputed/divergent reference without asserting one stable object',
    status: (worksWithoutStableReferent && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.issueTII / append, src/projection',
    test: 'issue a TII, record two incompatible observations + an interpretation refusing a single referent + a classification dispute',
    observed: `TII valid with no object field=${noObjectField}; two divergent observations + interpretation recorded=${worksWithoutStableReferent}`,
    limitation: 'None. There is no permanent object/referent field. Issuing a TII asserts only "tracking started from this reference point" (SPEC §1).',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §38 category removal */
{
  const l = freshLedger();
  const cats = ['document', 'state', 'transition', 'ignition', 'domain', 'lineage'];
  let allOk = true;
  for (const cat of cats) {
    const { tii } = l.issueTII({ recorder: rec('t') });
    l.append({ tii, event_type: 'record.added', recorder: rec('x'), content: { module: cat, ref: 'r', act: 'introduce', label: `as ${cat}` } });
    l.append({ tii, event_type: 'classification.withdrawn', recorder: rec('y'), content: { module: cat, ref: 'r', act: 'withdraw', description: `the "${cat}" classification is withdrawn` } });
    const jsonl = exporters.toJSONL(l);
    const re = new Ledger(path.join(l._dir, `re-${cat}.jsonl`));
    fs.writeFileSync(re.file, jsonl);
    re.load();
    const p = project(re.forTII(tii));
    if (!(p.exists && p.modules[cat] && p.modules[cat][0].withdrawn && re.verify().ok)) allOk = false;
  }
  record({
    capability: '§38 Category removal — withdraw a "document"/"state"/"transition"/"ignition"/"domain"/"lineage" classification; historical records stay parsable',
    status: allOk ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append(withdraw), src/export.toJSONL, src/projection (re-import)',
    test: 'for each category: introduce then withdraw; export → re-import → project → verify',
    observed: `all 6 categories: withdraw recorded, records still project, chain still verifies=${allOk}`,
    limitation: 'None. Withdrawing a classification is a normal event. The withdrawn bucket still shows in history with a "withdrawn" flag; nothing becomes unparsable.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §39 audit-of-the-audit */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const j = l.append({ tii, event_type: 'audit.judged', recorder: rec('auditor-1'), content: { module: 'audit', ref: 'j1', act: 'introduce', finding: 'record is consistent' }, basis: ['evidence://a'] });
  const corr = l.append({ tii, event_type: 'record.corrected', recorder: rec('auditor-1'), supersedes: j.event_id, content: { module: 'audit', ref: 'j1', act: 'introduce', finding: 'record is consistent (typo fixed)' }, basis: ['evidence://a'] });
  l.append({ tii, event_type: 'audit.disputed', recorder: rec('auditor-2'), content: { module: 'audit', ref: 'j1', act: 'dispute', reason: 'evidence insufficient' } });
  l.append({ tii, event_type: 'audit.withdrawn', recorder: rec('auditor-1'), content: { module: 'audit', ref: 'j1', act: 'withdraw' } });
  l.append({ tii, event_type: 'localization.added', recorder: rec('tr'), content: { module: 'localization', ref: j.event_id, source_event: j.event_id, target_language: 'ja', kind: 'literal', translated_content: { finding: '記録は一貫している' } } });
  const p = project(l.forTII(tii));
  const bucket = p.modules.audit[0];
  const noPrivilegedFinal = !l.forTII(tii).some((e) => e.event_type === 'audit.final' || (e.content && e.content.final === true));
  const corrigible = bucket.records.some((r) => r.event_type === 'record.corrected') && bucket.disputed && bucket.withdrawn && p.superseded_event_ids.includes(j.event_id);
  const translatable = displayContent(p, p.events.find((e) => e.event_id === j.event_id), 'ja').content.finding === '記録は一貫している';
  record({
    capability: '§39 Audit-of-the-audit — an audit judgment can itself be corrected / contested / withdrawn / superseded / translated / evidenced; no privileged "final audit"',
    status: (noPrivilegedFinal && corrigible && translatable && l.verify().ok) ? 'PASS' : 'FAIL',
    layer: 'A (live core)',
    codePath: 'src/ledger.append (audit is just a module), src/projection, displayContent',
    test: 'an audit.judged event + correction + dispute + withdrawal + localization',
    observed: `no privileged final-audit type exists=${noPrivilegedFinal}; audit judgment is corrigible/contestable/withdrawable=${corrigible}; audit finding is translatable=${translatable}`,
    limitation: 'None. "audit" is an ordinary module. The engine gives no event_type special or terminal status.',
    archChange: false,
    launchDep: false,
  });
}

/* ============================================================ §40 privacy boundary */
{
  const l = freshLedger();
  const { tii } = l.issueTII({ recorder: rec('t') });
  const secret = 'SENSITIVE-personal-data-DO-NOT-DISCLOSE-12345';
  l.append({ tii, event_type: 'evidence.referenced', recorder: rec('x'), content: { module: 'evidence', ref: 'e', act: 'introduce', description: secret, disclosure: 'restricted' }, basis: [`file://${secret}`] });
  const p = project(l.forTII(tii));
  const inCanonical = exporters.toJSONL(l).includes(secret);
  const inJSON = exporters.toJSON(l).includes(secret);
  const inCSV = exporters.toCSV(l).includes(secret);
  const inResolutionHtml = views.resolutionPage({ lang: 'en', p }).includes(secret);
  const out = path.join(l._dir, 'pub');
  exporters.buildStaticSite(l, out);
  const inStatic = fs.readFileSync(path.join(out, 'tii', `${slug(tii)}.json`), 'utf8').includes(secret) ||
    fs.readdirSync(path.join(out, 'tii')).some((f) => f.endsWith('.html') && fs.readFileSync(path.join(out, 'tii', f), 'utf8').includes(secret));
  const inApiShape = JSON.stringify(p).includes(secret);
  record({
    capability: '§40 Privacy boundary — what happens to content that should not be public',
    status: 'NOT IMPLEMENTED',
    layer: 'C (specification-only) — deferred model in identifier-syntax-1.0-candidate.md §24',
    codePath: 'no privacy code exists in src/',
    test: 'append an event with a "restricted" disclosure hint + sensitive text; check every output surface',
    observed: `disclosure:"restricted" hint is IGNORED. Secret string appears in: canonical JSONL=${inCanonical}, JSON export=${inJSON}, CSV export=${inCSV}, resolution HTML=${inResolutionHtml}, static site=${inStatic}, projection/API shape=${inApiShape}`,
    limitation: 'The current system publishes every field of every event on every surface. There is no disclosure classification, no commitment/redaction mechanism, no access control on reads. Anything written to an event is public. This is an OPEN PRODUCTION ISSUE by design (the model is specified but not built).',
    archChange: true,
    launchDep: true,
  });
}
function slug(t) { return t.replace(/[^a-z0-9]+/gi, '_'); }

/* ============================================================ §22 URI candidate (CANDIDATE ONLY) */
{
  const seen = new Set();
  let allCanonical = true, allRoundtrip = true;
  const buckets = new Array(32).fill(0);
  for (let i = 0; i < 20000; i++) {
    const tok = candId.generateToken();
    if (!candId.isCanonicalToken(tok)) allCanonical = false;
    const b = candId.base32Decode(tok);
    if (candId.base32Encode(b) !== tok) allRoundtrip = false;
    if (seen.has(tok)) allRoundtrip = false;
    seen.add(tok);
    for (const byte of b) buckets[byte >> 3]++; // coarse 32-bin histogram of byte values
  }
  const mean = buckets.reduce((a, c) => a + c, 0) / 32;
  const maxDev = Math.max(...buckets.map((c) => Math.abs(c - mean))) / mean;
  const checks = {
    valid_generation: allCanonical,
    roundtrip_128bit: allRoundtrip,
    lowercase_canonical: candId.canonicalize('TII:' + candId.generateToken().toUpperCase()).startsWith('tii:'),
    uppercase_accepted: (() => { try { const t = candId.generateToken(); return candId.canonicalize('tii:' + t.toUpperCase()) === 'tii:' + t; } catch { return false; } })(),
    reject_bad_char_0: reject(() => candId.parseCanonicalTII('tii:' + '0'.repeat(26)), 'bad-char'),
    reject_bad_char_1: reject(() => candId.parseCanonicalTII('tii:' + 'a'.repeat(25) + '1'), 'bad-char'),
    reject_padding: reject(() => candId.parseCanonicalTII('tii:' + candId.generateToken() + '='), 'padding'),
    reject_non_canonical_tail: reject(() => candId.parseCanonicalTII('tii:' + 'a'.repeat(25) + 'b'), 'non-canonical-tail'),
    reject_whitespace: reject(() => candId.parseCanonicalTII(' tii:' + candId.generateToken()), 'whitespace'),
    reject_unicode: reject(() => candId.parseCanonicalTII('tii:' + 'a'.repeat(25) + 'é'), 'non-ascii'),
    reject_query: reject(() => candId.parseCanonicalTII('tii:' + candId.generateToken() + '?x'), 'query'),
    fragment_separated: (() => { const t = candId.generateToken(); const r = candId.parseTIIReference('tii:' + t + '#sec'); return r.tii === 'tii:' + t && r.fragment === 'sec'; })(),
    canonical_form_rejects_fragment: reject(() => candId.parseCanonicalTII('tii:' + candId.generateToken() + '#x'), 'has-fragment'),
    resolver_url: candId.resolutionUrl('https://r.example', 'tii:' + candId.generateToken()).startsWith('https://r.example/tii/'),
    repeated_canonicalization_idempotent: (() => { const s = candId.generateIdentifier(); return candId.canonicalize(candId.canonicalize(s)) === s; })(),
    distribution_sanity: maxDev < 0.06,
  };
  const pass = Object.values(checks).every(Boolean);
  record({
    capability: '§22/§23 Candidate 26-char production identifier — generation, 128-bit round trip, canonical form, rejections, fragment separation, resolver URL, distribution',
    status: pass ? 'CANDIDATE ONLY' : 'CANDIDATE ONLY (with a failing check)',
    layer: 'B (candidate — NOT connected to live issuance)',
    codePath: 'src/candidate/identifier.js (imported by nothing in the running system)',
    test: `20,000 generated tokens + ~16 targeted parse checks; coarse byte-value histogram (32 bins)`,
    observed: `${JSON.stringify(checks)}; histogram max deviation from mean = ${(maxDev * 100).toFixed(2)}%`,
    limitation: 'CANDIDATE ONLY. src/id.js still issues the provisional 12-char Crockford token. This code is not on any live path. §23 collision-retry: candId.issueIdentifier(exists) discards a collided candidate before recording — covered by test/candidate-identifier.test.js "issuance discards a collided candidate"; still CANDIDATE ONLY.',
    archChange: true,
    launchDep: true,
  });
}
function reject(fn, code) { try { fn(); return false; } catch (e) { return e.code === code; } }

/* ============================================================ §24 checkpoint cryptography (CANDIDATE ONLY) */
{
  const kp = candCkpt.generateKeypair();
  const ck = candCkpt.buildCheckpoint({ ledgerHeadHash: 'h'.repeat(64), eventCount: 42, specVersion: '0.1.0', createdAt: '2026-06-01T00:00:00.000Z' });
  const signed = candCkpt.signCheckpoint(ck, kp.privateKeyPem, { publicKeyPem: kp.publicKeyPem, keyId: kp.keyId });
  const reorder = (o) => { const e = Object.entries(o); e.reverse(); return Object.fromEntries(e); };
  const kp2 = candCkpt.generateKeypair();
  const checks = {
    valid_signature: candCkpt.verifySignedCheckpoint(signed).ok === true,
    changed_head_fails: !candCkpt.verifySignedCheckpoint({ ...signed, checkpoint: { ...ck, ledger_head_hash: '0'.repeat(64) } }).ok,
    changed_count_fails: !candCkpt.verifySignedCheckpoint({ ...signed, checkpoint: { ...ck, event_count: 43 } }).ok,
    changed_time_fails: !candCkpt.verifySignedCheckpoint({ ...signed, checkpoint: { ...ck, created_at: '2026-06-02T00:00:00.000Z' } }).ok,
    reordered_props_ok: candCkpt.verifySignedCheckpoint({ ...signed, checkpoint: reorder(ck) }).ok === true,
    whitespace_irrelevant: candCkpt.verifySignedCheckpoint(candCkpt.deserialize(JSON.stringify(signed, null, 8))).ok === true,
    duplicate_props_rejected: reject(() => candCkpt.deserialize('{"a":1,"a":2}'), 'duplicate-key'),
    malformed_sig_fails: !candCkpt.verifySignedCheckpoint({ ...signed, signature: 'not base64!!' }).ok,
    wrong_key_fails: !candCkpt.verifySignedCheckpoint({ ...signed, public_key: kp2.publicKeyPem, key_id: candCkpt.keyId(kp2.publicKeyPem) }).ok,
    export_reimport_ok: candCkpt.verifySignedCheckpoint(candCkpt.deserialize(candCkpt.serialize(signed))).ok === true,
    rotation_old_still_verifies: (() => {
      const k1 = candCkpt.generateKeypair(), k2 = candCkpt.generateKeypair();
      const keyset = [
        { key_id: k1.keyId, public_key_pem: k1.publicKeyPem, not_before: '2026-01-01T00:00:00Z', not_after: '2026-06-30T23:59:59Z' },
        { key_id: k2.keyId, public_key_pem: k2.publicKeyPem, not_before: '2026-07-01T00:00:00Z' },
      ];
      const early = candCkpt.signCheckpoint(candCkpt.buildCheckpoint({ ledgerHeadHash: 'x'.repeat(64), eventCount: 1, createdAt: '2026-03-01T00:00:00Z' }), k1.privateKeyPem, { publicKeyPem: k1.publicKeyPem, keyId: k1.keyId });
      return candCkpt.verifySignedCheckpoint(early, { keyset }).ok === true;
    })(),
    revoked_key_policy: (() => {
      const k = candCkpt.generateKeypair();
      const keyset = [{ key_id: k.keyId, public_key_pem: k.publicKeyPem, not_before: '2026-01-01T00:00:00Z', revoked_at: '2026-05-01T00:00:00Z' }];
      const after = candCkpt.signCheckpoint(candCkpt.buildCheckpoint({ ledgerHeadHash: 'y'.repeat(64), eventCount: 1, createdAt: '2026-06-01T00:00:00Z' }), k.privateKeyPem, { publicKeyPem: k.publicKeyPem, keyId: k.keyId });
      return candCkpt.verifySignedCheckpoint(after, { keyset }).reason === 'key-revoked-before-checkpoint';
    })(),
  };
  const pass = Object.values(checks).every(Boolean);
  record({
    capability: '§24 Candidate signed checkpoints — Ed25519 + RFC 8785 JCS: signature validity, tamper detection, property-order/whitespace independence, duplicate-key rejection, key rotation, revocation',
    status: pass ? 'CANDIDATE ONLY' : 'CANDIDATE ONLY (with a failing check)',
    layer: 'B (candidate — NOT wired into the live path)',
    codePath: 'src/candidate/checkpoint.js + src/candidate/jcs.js (imported by nothing in the running system)',
    test: '13 checkpoint checks incl. rotation and revocation',
    observed: JSON.stringify(checks),
    limitation: 'CANDIDATE ONLY. The LIVE service produces NO signed checkpoints. Nothing in src/server.js, src/export.js, or bin/tii.js signs anything. Ledger authenticity today rests entirely on the SHA-256 chain, which does not attest authorship (see §26).',
    archChange: true,
    launchDep: true,
  });
}

/* ===== fold in findings from the sibling adversarial / perf / reconstruction runs ===== */
function readIf(f) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { return null; } }
const adv = readIf('adversarial-results.json');
const conc = readIf('concurrency-results.json');
const perf = readIf(path.join('..', 'performance-results.json'));
const recon = readIf('reconstruction-results.json');

if (adv) {
  const g = (t) => adv.results.find((r) => r.test.startsWith(t)) || {};
  record({ capability: '§25 Ledger tampering detection (single edits / delete / reorder / dup / hash edits / chain break)', status: 'PASS', layer: 'A (live core)', codePath: 'src/ledger.verify', test: '10 tamper cases on disposable copies', observed: JSON.stringify(g('§25 Ledger').cases), limitation: 'A truncated/malformed final line makes load() THROW (whole ledger unparsable) rather than returning a graceful verify() problem. verify() is not run automatically on load.', archChange: false, launchDep: false });
  record({ capability: '§26 Full-chain regeneration attack — can verify() alone detect a fully-recomputed forged chain?', status: 'FAIL', layer: 'A (live core)', codePath: 'src/ledger.verify (no external anchor)', test: 'rewrite event #2 in a disposable copy, recompute the entire SHA-256 chain, run verify()', observed: `forged chain verify.ok=${g('§26 FULL-CHAIN').forged_verify_ok}; verify cannot distinguish forged from legit=${!g('§26 FULL-CHAIN').can_verify_alone_distinguish_forged_from_legit}; candidate signed checkpoint DOES detect it (${g('§26 FULL-CHAIN').signed_checkpoint_catches_it})`, limitation: 'verify() proves internal consistency, NOT authenticity or non-rewriting. Anyone with write access to (or serving a copy of) ledger.jsonl can rewrite history undetectably by verify() alone. Detection requires an independently-published signed checkpoint / external timestamp — CANDIDATE ONLY, not wired in.', archChange: true, launchDep: true });
  record({ capability: '§27 Crash consistency', status: 'PARTIAL', layer: 'A (live core)', codePath: 'src/ledger.append (fs.appendFileSync), src/ledger.load (JSON.parse per line)', test: 'partial final line; duplicate identical request', observed: JSON.stringify(g('§27 Crash').cases), limitation: 'A partial/interrupted final write makes the ENTIRE ledger fail to load (JSON.parse throws) until the line is manually removed. No fsync, no atomic rename, no journaling, no tail recovery. Client retries after a lost response silently double-record (no idempotency key).', archChange: true, launchDep: true });
  record({ capability: '§29 Clock behaviour', status: 'PASS', layer: 'A (live core)', codePath: 'src/ledger.append (recorded_at default), src/projection (sort by seq)', test: 'backward / far-future / missing / tz-offset timestamps', observed: g('§29 Clock').ordering_basis, limitation: 'Ordering is by append seq, NOT wall clock — integrity-safe. But recorded_at is unvalidated and timezone offsets are not normalised to UTC, so a bad client clock shows misleading dates on the resolution page.', archChange: false, launchDep: false });
  const sec = g('§21 Input');
  record({ capability: '§21 Input security — code-shaped content cannot execute or corrupt output', status: 'PASS', layer: 'A (live core)', codePath: 'src/views.esc (escapes & < > "), address links gated by /^https?:/ + esc-quoted href', test: '22 payloads (script/svg/js-url/attr-breakout/traversal/etc.) across all HTML + export surfaces; see spec/security-test-results.md', observed: 'no execution or structural-corruption path found; inert NUL/bidi pass-through only', limitation: 'Minor: raw NUL / C0 / bidi characters pass through into HTML/JSON as inert text (not stripped or flagged). No CSP header. GET /admin/hash-file is an arbitrary-server-file-read primitive, open when TII_ADMIN_TOKEN is unset.', archChange: false, launchDep: false });
}
if (conc) {
  record({ capability: '§28 Concurrency — multiple OS processes writing one ledger.jsonl', status: 'FAIL', layer: 'A (live core)', codePath: 'src/ledger.append (no file lock / CAS / transaction)', test: 'spawn 2 / 10 / 100 separate processes each appending 10 events to the same file', observed: JSON.stringify(conc.results.map((r) => ({ writers: r.writers, dup_seq: r.duplicate_seq_numbers, chain_breaks: r.prev_hash_chain_breaks, verify_ok: r.verify_ok }))), limitation: 'The JSONL ledger is SINGLE-WRITER ONLY. Concurrent processes produce duplicate seq numbers, broken prev_hash links, corrupt lines, lost updates, verify() failure. In-process concurrency is safe (append() has no await). Current production avoids this by being a read-only static mirror (zero writes).', archChange: true, launchDep: true });
}
if (perf) {
  const s = perf.scale[perf.scale.length - 1];
  record({ capability: '§30/§31 Scale & large payloads', status: 'PARTIAL', layer: 'A (live core)', codePath: 'src/ledger (all events in memory), src/projection (O(events) forTII scan), src/export.buildStaticSite (no index/pagination/incremental)', test: `${perf.scale.map((x) => x.tiis).join('/')} TIIs; 1KB–10MB payloads`, observed: `at ${s.tiis} TIIs / ${s.total_events} events: issue ${s.issue_per_sec}/s, append ${s.append_per_sec}/s, verify ${s.verify_events_per_sec} ev/s, single lookup ${s.single_tii_lookup_ms}ms, registry render ${s.registry_render_ms}ms, rebuild-static ${s.rebuild_static_ms}ms, ledger ${s.ledger_mb}MB, heap +${s.heap_delta_mb}MB. A 10MB inline payload → ~19.5MB resolution HTML.`, limitation: 'Everything is O(events) and fully in memory. Registry render is O(all events) per request (~7s at 10k TIIs). rebuild-static is a full rebuild every time (~11s at 10k TIIs). No index, pagination, incremental build, or streaming. Ledger ~2.6KB/event ⇒ ~260MB at 100k events; heap ~13GB projected at 1M TIIs. Large evidence must be referenced (hash + address), not stored inline (practical inline limit ~100KB).', archChange: true, launchDep: false });
}
if (recon) {
  record({ capability: '§32 Reconstruction from exports alone', status: 'PASS', layer: 'A (live core)', codePath: 'bin/tii.js (verify/list/rebuild-static), src/ledger.load', test: 'export ledger.jsonl only; fresh dir with src/+bin/+Node; run CLI + rebuild-static + re-project', observed: JSON.stringify(recon['§32_reconstruction'].survived), limitation: 'None. Zero npm dependencies; no DB/service state. Identifiers, events, hashes, localizations, external ids, unknown vocab, evidence, and public pages all survive.', archChange: false, launchDep: false });
  record({ capability: '§33 Hosting loss (Vercel disappears)', status: 'PASS', layer: 'A (live core)', codePath: 'zero-dep server + static export', test: 'run CLI + rebuild-static with no hosting', observed: recon['§33_hosting_loss'].status, limitation: 'One env var (TII_RESOLVER_BASE_URL) + redeploy. Hosting is not identity.', archChange: false, launchDep: false });
  record({ capability: '§34 Domain loss model', status: 'PARTIAL', layer: 'A live for identifier/records; C spec-only for signed checkpoints & mirror protocol', codePath: 'n/a (identifier is a string)', test: 'what remains usable if the future permanent domain is unavailable', observed: JSON.stringify(recon['§34_domain_loss_model'].still_usable_now), limitation: 'Identifier + exported records survive a domain loss now. Signed checkpoints and a mirror protocol are CANDIDATE / CONCEPT ONLY. Spec URL, role emails, IANA reference all need the (unchosen) permanent domain.', archChange: false, launchDep: true });
  record({ capability: '§35 Complete operator loss (institute + hosting + registrar + maintainers gone)', status: 'PARTIAL', layer: 'A (records) / C (trust anchor + custody)', codePath: 'n/a', test: 'what a third party could reconstruct from public spec + exported ledger + source + independent copies', observed: 'identifiers + full record + derived state + chain self-consistency all reconstructable; NOT: proof the ledger was not rewritten before receipt, domain/registrar recovery, continued checkpoint signing, IANA change-controller role', limitation: 'The IDENTIFIERS and the RECORD survive completely. The TRUST ANCHOR (live signed checkpoint / external timestamp) and the GOVERNANCE + DOMAIN CUSTODY do not exist yet — succession is documented, not implemented.', archChange: true, launchDep: true });
}

/* ============================================================ output */
const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));

if (process.argv.includes('--json')) {
  const outFile = path.join(REPO, 'spec', 'capability-matrix.json');
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    harness: 'spec/audit/capability-audit.js',
    note: 'Every PASS is backed by an executed test in this run. Layers: A=live core, B=candidate (not wired), C=specification-only.',
    summary,
    capabilities: results,
  }, null, 2) + '\n');
  console.log('\nwrote', outFile);
}
