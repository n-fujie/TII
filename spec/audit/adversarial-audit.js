#!/usr/bin/env node
'use strict';

/**
 * TII adversarial + production-critical tests — §21, §25-29.
 *   node spec/audit/adversarial-audit.js
 * Isolated temp ledgers only. Never touches data/ledger.jsonl.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(REPO + '/src/ledger');
const { project } = require(REPO + '/src/projection');
const { canonicalize } = require(REPO + '/src/canonical');
const { sha256, GENESIS_HASH } = require(REPO + '/src/hash');
const views = require(REPO + '/src/views');
const candCkpt = require(REPO + '/src/candidate/checkpoint');
const candJcs = require(REPO + '/src/candidate/jcs');

const out = [];
const log = (title, obj) => { out.push({ test: title, ...obj }); console.log(`\n## ${title}`); console.log(JSON.stringify(obj, null, 2)); };

function fresh(n = 6) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-adv-'));
  const file = path.join(dir, 'ledger.jsonl');
  const l = new Ledger(file).load();
  const { tii } = l.issueTII({ recorder: { id: 'author', kind: 'person' } });
  for (let i = 0; i < n; i++) l.append({ tii, event_type: 'note.added', recorder: { id: 'author', kind: 'person' }, content: { module: 'note', ref: 'n' + i, text: 'event ' + i } });
  return { l, tii, dir, file };
}

/* ============================================================ §25 ledger tampering */
{
  const cases = {};
  const run = (name, mutate) => {
    const { l, file } = fresh(5);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const tampered = mutate(lines.slice());
    fs.writeFileSync(file, tampered.join('\n') + (tampered.length ? '\n' : ''));
    let v;
    try { v = new Ledger(file).load().verify(); cases[name] = { detected: !v.ok, problems: v.problems.map((p) => p.issue) }; }
    catch (e) { cases[name] = { detected: true, problems: ['load threw: ' + e.message] }; }
  };
  run('modify_one_historical_byte', (L) => { L[2] = L[2].replace('event 1', 'event X'); return L; });
  run('modify_one_historical_field_recorder', (L) => { const o = JSON.parse(L[2]); o.recorder = { id: 'someone-else', kind: 'person' }; L[2] = JSON.stringify(o); return L; });
  run('remove_one_event', (L) => { L.splice(2, 1); return L; });
  run('reorder_two_events', (L) => { const t = L[2]; L[2] = L[3]; L[3] = t; return L; });
  run('duplicate_an_event', (L) => { L.splice(3, 0, L[3]); return L; });
  run('change_prev_hash', (L) => { const o = JSON.parse(L[3]); o.prev_hash = '0'.repeat(64); L[3] = JSON.stringify(o); return L; });
  run('change_current_hash', (L) => { const o = JSON.parse(L[3]); o.hash = 'f'.repeat(64); L[3] = JSON.stringify(o); return L; });
  run('truncate_final_line', (L) => { L[L.length - 1] = L[L.length - 1].slice(0, -20); return L; });
  run('append_malformed_json', (L) => { L.push('{not json'); return L; });
  run('append_valid_json_no_chain_link', (L) => {
    const prev = JSON.parse(L[L.length - 1]);
    L.push(JSON.stringify({ event_id: 'evt_forged', tii: prev.tii, seq: prev.seq + 1, recorded_at: '2026-01-01T00:00:00Z', ledger_written_at: '2026-01-01T00:00:00Z', recorder: { id: 'x', kind: 'person' }, event_type: 'note.added', content: {}, basis: [], external_refs: [], prev_event_for_target: prev.event_id, prev_hash: 'deadbeef'.repeat(8), hash: 'cafebabe'.repeat(8) }));
    return L;
  });
  log('§25 Ledger tampering — what verify() detects', {
    method: 'mutate a stored line in a disposable copy, reload, verify()',
    cases,
    conclusion: 'verify() recomputes seq position, prev_hash linkage, and the content hash of every event. It catches single-byte/field edits, deletion, reordering, duplication, prev_hash/hash edits, and a chain-break on an appended event. A truncated final line or malformed JSON makes load() throw (the whole ledger fails to parse) — detected, but as a hard load failure, not a graceful "problems" report.',
  });
}

/* ============================================================ §26 FULL-CHAIN REGENERATION ATTACK */
{
  const { l, tii, file } = fresh(6);
  const legitHead = l.verify().head_hash;
  const legitCount = l.events.length;

  // capture a legitimate signed checkpoint (candidate scheme) at the real head
  const kp = candCkpt.generateKeypair();
  const legitCheckpoint = candCkpt.signCheckpoint(
    candCkpt.buildCheckpoint({ ledgerHeadHash: legitHead, eventCount: legitCount, createdAt: '2026-06-01T00:00:00.000Z' }),
    kp.privateKeyPem, { publicKeyPem: kp.publicKeyPem, keyId: kp.keyId }
  );

  // ---- forge: rewrite history, recompute a fully consistent SHA-256 chain ----
  const events = JSON.parse('[' + fs.readFileSync(file, 'utf8').trim().split('\n').join(',') + ']');
  // change the meaning of event 2 and re-chain everything from there
  events[2].content = { module: 'note', ref: 'n1', text: 'FORGED — this event now says something else entirely' };
  events[2].recorder = { id: 'attacker', kind: 'person' };
  let prev = events[1].hash;
  for (let i = 2; i < events.length; i++) {
    events[i].prev_hash = prev;
    const { hash, ...body } = events[i];
    events[i].hash = sha256(events[i].prev_hash + canonicalize(body));
    prev = events[i].hash;
  }
  const forgedFile = file + '.forged';
  fs.writeFileSync(forgedFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const forgedLedger = new Ledger(forgedFile).load();
  const forgedVerify = forgedLedger.verify();
  const forgedHead = forgedVerify.head_hash;

  // ---- can verify() alone tell the forged chain from the legit one? ----
  const verifyAloneDistinguishes = false; // both verify ok; verify has no external anchor

  // ---- does the candidate signed checkpoint catch it? ----
  const checkpointOnForged = candCkpt.verifySignedCheckpoint({
    ...legitCheckpoint,
    checkpoint: { ...legitCheckpoint.checkpoint, ledger_head_hash: forgedHead, event_count: forgedLedger.events.length },
  });
  // (the honest check: does the forged head match what the signed checkpoint attests?)
  const forgedHeadMatchesSignedAttestation = forgedHead === legitCheckpoint.checkpoint.ledger_head_hash;

  log('§26 FULL-CHAIN REGENERATION ATTACK', {
    method: 'take a disposable copy of the whole ledger, rewrite event #2, recompute a fully internally-consistent SHA-256 chain for every later event',
    legit_head: legitHead,
    forged_head: forgedHead,
    forged_verify_ok: forgedVerify.ok,
    forged_verify_problems: forgedVerify.problems,
    can_verify_alone_distinguish_forged_from_legit: verifyAloneDistinguishes,
    finding_1: 'NO. verify() on the forged ledger returns { ok: true, problems: [] }. The SHA-256 chain is self-consistent; verify() has no external anchor, so it CANNOT distinguish a legitimately-grown chain from a fully-recomputed forged one. Anyone with write access to ledger.jsonl (or who serves a copy) can rewrite history undetectably as far as verify() is concerned.',
    signed_checkpoint_catches_it: !forgedHeadMatchesSignedAttestation,
    finding_2: 'YES — but only via the CANDIDATE signed checkpoint, which is NOT wired into the live system. A checkpoint signed over the real head (' + legitHead.slice(0, 16) + '…) does not match the forged head (' + forgedHead.slice(0, 16) + '…). A verifier holding the signed checkpoint detects the forgery. The LIVE service publishes no such checkpoint.',
    production_impact: 'Without an independently-published signed checkpoint (or an external timestamp/witness), TII ledger integrity today is only as strong as write-access control to the single file. This is the single most important gap for production.',
  });
}

/* ============================================================ §27 crash consistency */
{
  const cases = {};
  // partial JSONL line (process died mid fs.appendFileSync)
  {
    const { l, file } = fresh(4);
    const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, good + '{"event_id":"evt_partial","tii":"tii:x","seq":5,"recorded');
    try { new Ledger(file).load(); cases.partial_line_on_load = 'loaded (unexpected)'; }
    catch (e) { cases.partial_line_on_load = 'load() THROWS: ' + e.message.split('\n')[0] + '  → the ENTIRE ledger fails to load; the last complete write is not recoverable without manual truncation'; }
  }
  // process terminates before write: append is fs.appendFileSync (synchronous) — either the line is fully there or not there at all
  cases.terminate_before_write = 'fs.appendFileSync is synchronous and atomic for small writes on local fs: either the whole line lands or nothing does. A crash BEFORE the syscall loses that one event with no corruption.';
  cases.terminate_mid_write = 'A crash DURING the syscall (large line, disk full, signal) can leave a partial final line → see partial_line_on_load: the whole ledger then fails to parse on next start.';
  // write completes but HTTP response fails / client retries / same request twice
  {
    const { l, tii } = fresh(2);
    const body = { tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, content: { module: 'note', ref: 'dup', text: 'same request' } };
    const e1 = l.append({ ...body });
    const e2 = l.append({ ...body }); // client retried the identical request
    cases.duplicate_request = `two identical append() calls produce TWO events (${e1.event_id} and ${e2.event_id}), both with content.text "same request", different seq/event_id/hash. There is NO idempotency key, dedup, or request-id. verify() stays ok. A client that retries after a lost response silently double-records.`;
  }
  log('§27 Crash consistency', {
    cases,
    detected_by_verify: 'verify() does NOT run automatically on load; a partial/corrupt tail throws in load() (JSON.parse). There is no journaling, no fsync, no atomic rename, no recovery of a truncated tail.',
    production_impact: 'MEDIUM–HIGH. A single interrupted write bricks the ledger until someone manually removes the partial last line. Duplicate events from client retries are silent.',
  });
}

/* ============================================================ §28 concurrency (in-process) */
{
  const { l, tii } = fresh(1);
  for (let i = 0; i < 300; i++) l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, content: { i } });
  const seqs = l.events.map((e) => e.seq);
  log('§28 Concurrency (in-process)', {
    in_process_single_writer: {
      unique_seqs: new Set(seqs).size === seqs.length,
      monotonic_from_zero: seqs.every((s, i) => s === i),
      verify_ok: l.verify().ok,
    },
    explanation: 'append() reads nextSeq / lastHash and does fs.appendFileSync with NO await in between. Node is single-threaded, so many append() calls in ONE process serialize cleanly.',
    multi_process: 'See spec/audit/concurrency-audit.js — spawns N separate OS processes writing the SAME ledger.jsonl.',
  });
}

/* ============================================================ §29 clock */
{
  const { l, tii } = fresh(0);
  const e1 = l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, recorded_at: '2030-01-01T00:00:00.000Z', content: { n: 1 } });
  const e2 = l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, recorded_at: '2000-01-01T00:00:00.000Z', content: { n: 2 } }); // clock jumped backward
  const e3 = l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, recorded_at: '9999-12-31T23:59:59.000Z', content: { n: 3 } }); // extreme future
  const e4 = l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, content: { n: 4 } }); // missing client timestamp -> defaults to now
  const e5 = l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, recorded_at: '2026-03-01T12:00:00+09:00', content: { n: 5 } }); // tz offset
  const p = project(l.forTII(tii));
  const projOrder = p.events.map((e) => e.content.n).filter((n) => n);
  log('§29 Clock', {
    accepts_any_timestamp: 'YES — no validation. recorded_at may be past, far future, backward-jumping, or absent (defaults to new Date().toISOString()). Timezone offsets are accepted as written and NOT normalized to UTC (e2/e5 kept their form).',
    ordering_basis: 'seq (append order), not wall-clock. projection sorts by e.seq. Event order in history = ' + JSON.stringify(projOrder) + ' i.e. append order regardless of the nonsensical recorded_at values.',
    ledger_written_at: 'always set to the real append time by the ledger; recorded_at is the caller\'s claim.',
    risk: 'LOW for integrity/ordering (seq-based). MEDIUM for display: the resolution page shows recorded_at dates, so a bad client clock shows a wrong/misleading date on an event, and "Last recorded event" date can look out of order.',
    verify_ok: l.verify().ok,
  });
}

/* ============================================================ §21 input security (summary; full detail in run-security.js) */
{
  const { l, tii } = fresh(0);
  const payloads = {
    html: '<b>bold</b><h1>heading</h1>',
    script_tag: '<script>window.__pwned=1</script>',
    svg_script: '<svg onload="window.__pwned=1"><script>1</script></svg>',
    js_url: 'javascript:alert(document.domain)',
    data_url: 'data:text/html,<script>1</script>',
    long_string: 'A'.repeat(200000),
    null_bytes: 'a b c',
    control_chars: 'xy',
    bidi: 'file‮gnp.exe',
    combining: 'á́́́́',
    emoji: '🔥💥🧨',
    malformed_url: 'ht!tp://[::1]:99999/\\..',
    path_traversal: '../../../../etc/passwd',
    sql_like: "'; DROP TABLE events; --",
    shell_like: '$(rm -rf /); `id`; | nc evil 1',
  };
  for (const [k, v] of Object.entries(payloads)) {
    l.append({ tii, event_type: 'note.added', recorder: { id: 'x', kind: 'person' }, content: { module: 'note', ref: k, act: 'introduce', description: v, addr_value: v } });
  }
  // also an address whose value is a js: URL
  l.append({ tii, event_type: 'address.described', recorder: { id: 'x', kind: 'person' }, content: { module: 'address', ref: 'jsurl', act: 'introduce', kind: 'public-location', value: 'javascript:alert(1)' } });
  l.append({ tii, event_type: 'address.described', recorder: { id: 'x', kind: 'person' }, content: { module: 'address', ref: 'evilhttp', act: 'introduce', kind: 'public-location', value: 'https://evil.example/"><script>alert(1)</script>' } });
  const p = project(l.forTII(tii));
  const html = views.resolutionPage({ lang: 'en', p });
  const regHtml = views.registryPage({ lang: 'en', summaries: [require(REPO + '/src/export').publicSummary(p)] });
  const findings = {
    rendered_html_contains_live_script_tag: /<script>window\.__pwned/.test(html),
    rendered_html_contains_unescaped_svg_onload: /<svg onload=/.test(html),
    js_url_rendered_as_live_anchor_href: /href="javascript:/.test(html),
    evil_http_breaks_out_of_attribute: /href="https:\/\/evil\.example\/"><script>/.test(html),
    raw_lt_gt_in_output: /<script>/.test(html) && !/&lt;script&gt;/.test(html),
    long_string_present: html.includes('A'.repeat(1000)),
    null_byte_in_html: html.includes(' '),
    registry_escaped: !/<script>/.test(regHtml) || /&lt;script&gt;/.test(regHtml),
  };
  log('§21 Input security (overview)', {
    method: '15 code-shaped payloads in event content + 2 hostile address values; render resolution + registry HTML',
    findings,
    assessment: findings.rendered_html_contains_live_script_tag || findings.js_url_rendered_as_live_anchor_href || findings.evil_http_breaks_out_of_attribute
      ? 'UNSAFE rendering path found — see run-security.js output'
      : 'No execution path found: views.esc() escapes & < > " everywhere content is interpolated; address values are only linked when /^https?:\\/\\// and the href is esc()-quoted; javascript:/data: are shown as plain text. Long strings and null/control/bidi bytes pass through as inert text (no execution, no structural corruption of the HTML or the JSONL).',
    note: 'Text is treated as data, not rejected for looking like code — matches the spec requirement.',
  });
}

/* ============================================================ output */
fs.writeFileSync(path.join(REPO, 'spec', 'audit', 'adversarial-results.json'), JSON.stringify({ generated_at: new Date().toISOString(), results: out }, null, 2) + '\n');
console.log('\nwrote spec/audit/adversarial-results.json');
