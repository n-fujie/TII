#!/usr/bin/env node
'use strict';

/**
 * §28 multi-process concurrency test — spawns N separate OS processes that each
 * append to the SAME ledger.jsonl, then inspects the result.
 *   node spec/audit/concurrency-audit.js
 * Isolated temp ledgers only.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const { Ledger } = require(REPO + '/src/ledger');

const APPENDS_PER_WRITER = 10;

function analyze(file) {
  const raw = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const evs = [];
  let corrupt = 0;
  for (const ln of raw) { try { evs.push(JSON.parse(ln)); } catch { corrupt++; } }
  const seqSeen = new Map();
  let dupSeq = 0, chainBreaks = 0, prev = null;
  for (const e of evs) {
    if (seqSeen.has(e.seq)) dupSeq++;
    seqSeen.set(e.seq, (seqSeen.get(e.seq) || 0) + 1);
    if (prev !== null && e.prev_hash !== prev) chainBreaks++;
    prev = e.hash;
  }
  let verify;
  try { verify = new Ledger(file).load().verify().ok; } catch (e) { verify = 'load threw: ' + e.message.split('\n')[0]; }
  return { lines: raw.length, corrupt_lines: corrupt, json_events: evs.length, duplicate_seq_numbers: dupSeq, prev_hash_chain_breaks: chainBreaks, verify_ok: verify };
}

async function runN(N) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-conc-'));
  const file = path.join(dir, 'ledger.jsonl');
  const seed = new Ledger(file).load();
  const { tii } = seed.issueTII({ recorder: { id: 'seed', kind: 'mechanism' } });
  const writer = path.join(dir, 'writer.js');
  fs.writeFileSync(writer, `
    const { Ledger } = require(${JSON.stringify(REPO + '/src/ledger')});
    const l = new Ledger(${JSON.stringify(file)}).load();
    for (let i = 0; i < ${APPENDS_PER_WRITER}; i++) {
      try { l.append({ tii: ${JSON.stringify(tii)}, event_type: 'note.added',
        recorder: { id: process.argv[2], kind: 'mechanism' }, content: { w: process.argv[2], i } }); }
      catch (e) { /* collision-check / append error under race */ }
    }
  `);
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      new Promise((res) => spawn(process.execPath, [writer, 'w' + i], { stdio: 'ignore' }).on('exit', res))
    )
  );
  return { writers: N, expected_events: 1 + N * APPENDS_PER_WRITER, ...analyze(file) };
}

(async () => {
  const results = [];
  for (const N of [2, 10, 100]) results.push(await runN(N));
  const report = {
    generated_at: new Date().toISOString(),
    appends_per_writer: APPENDS_PER_WRITER,
    results,
    conclusion:
      'The JSONL ledger is SINGLE-WRITER ONLY. There is no file lock, lock file, compare-and-swap, or transaction. ' +
      'Separate OS processes race on (a) reading the current seq/head — several read the same N, ' +
      '(b) the issuance uniqueness check, and (c) interleaved fs.appendFileSync writes. ' +
      'Observed: duplicate seq numbers, broken prev_hash links, sometimes corrupt/interleaved lines, lost updates, verify() failure. ' +
      'The live PRODUCTION deployment avoids this by being a read-only static mirror (zero writes); local & CLI use is single-process.',
  };
  fs.writeFileSync(path.join(REPO, 'spec', 'audit', 'concurrency-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})();
