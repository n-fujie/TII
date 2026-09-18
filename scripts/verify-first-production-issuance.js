#!/usr/bin/env node
'use strict';
/**
 * Read-only verification of the first production TII issuance's evidence.
 *
 * SAFETY (do not weaken these properties when editing this file):
 *   - Never imports src/production-issuance.js or src/production-gate.js —
 *     this script is structurally incapable of issuing anything or
 *     evaluating/satisfying the production gate, not merely disciplined
 *     about not calling those functions.
 *   - Never touches process.env beyond reading it for informational
 *     display; never resolves, requests, or references a signing-key
 *     passphrase.
 *   - Every operation is a read: git rev-parse/show, fs.readFileSync,
 *     Ledger.load() (no .append()), checkpointStore.verifyCheckpoint()
 *     (public key only, never resolveSigningKey()). No file is written,
 *     moved, or deleted by this script.
 *   - Exits non-zero on ANY mismatch (fail closed) — never warns-and-
 *     continues on a verification failure.
 *   - Distinguishes EXPECTED IMMUTABLE facts about the first issuance
 *     (hard-coded below, must never change) from CURRENT repository state
 *     (freely reported, not asserted to be frozen forever — a later,
 *     separately-authorized issuance is expected to change these and is
 *     not itself a failure this script should report).
 *
 * Usage: node scripts/verify-first-production-issuance.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const { Ledger } = require(path.join(REPO, 'src/ledger.js'));
const checkpointStore = require(path.join(REPO, 'src/checkpoint-store.js'));

// ---------------------------------------------------------------- facts --
// Hard-coded, expected-immutable facts about the FIRST production
// issuance, independent of anything else that may exist in the ledger by
// the time this script runs. These values are never recomputed "as of
// now" and silently accepted if different — a difference here is exactly
// what this script exists to catch.
const EXPECTED = {
  tagName: 'tii-first-production-issuance-2026-09-17',
  tagResolvedCommit: '2306df1c0741e0d7046bbc45957d21dad50a082d',
  sopCommit: '035b55de1cb3efc53fbb97453defdb755a34c823',
  firstIssuanceCommit: '419de8f6988415e7bb55faf69fa161d57ea9fbac',
  event: {
    event_id: 'evt_bfrbdmdd6sprept3',
    tii: 'tii:fabdi3ifjwteyi3os2hwmx2l5i',
    seq: 10,
    prev_hash: 'eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95',
    hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc',
    identifier_status: 'production',
  },
  checkpointKeyId: '1486de6152baec7f',
  knownCheckpointFiles: [
    { file: 'checkpoint-0000000010-2026-09-17T031239532Z-d1515f.json', event_count: 10, head_hash: 'eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95' },
    { file: 'checkpoint-0000000011-2026-09-17T041740279Z-51b8e4.json', event_count: 11, head_hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc' },
    { file: 'checkpoint-0000000011-2026-09-17T041740340Z-fbf603.json', event_count: 11, head_hash: '398b085ecf6784b5a8bad5c97bd70fb200cd3966ebaabfe82ba10ee50538e4bc' },
  ],
};

const results = [];
let failed = false;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

/* --------------------------------------------------- 1. tag identity --- */
try {
  const resolved = git(['rev-parse', `${EXPECTED.tagName}^{commit}`]);
  check('tag resolves to the expected immutable commit', resolved === EXPECTED.tagResolvedCommit, { expected: EXPECTED.tagResolvedCommit, observed: resolved });
} catch (e) {
  check('tag resolves to the expected immutable commit', false, { error: e.message });
}

/* ----------------------------------------------- 2. known commits exist --- */
for (const [label, sha] of [
  ['SOP documentation commit', EXPECTED.sopCommit],
  ['first production issuance commit', EXPECTED.firstIssuanceCommit],
]) {
  try {
    const resolved = git(['rev-parse', sha]);
    check(`${label} exists and matches`, resolved === sha, { expected: sha, observed: resolved });
  } catch (e) {
    check(`${label} exists and matches`, false, { error: e.message });
  }
}

/* -------------------------------------------------- 3. ledger, read-only --- */
const ledgerFile = path.join(REPO, 'data', 'ledger.jsonl');
const ledger = new Ledger(ledgerFile).load();
const chain = ledger.verify();
check('ledger chain integrity (current state)', chain.ok === true, chain);

const firstIssuanceEvent = ledger.getEvent(EXPECTED.event.event_id);
check('the first production issuance event still exists, unmoved', !!firstIssuanceEvent, { event_id: EXPECTED.event.event_id });
if (firstIssuanceEvent) {
  check('first production issuance event fields unchanged', (
    firstIssuanceEvent.tii === EXPECTED.event.tii &&
    firstIssuanceEvent.seq === EXPECTED.event.seq &&
    firstIssuanceEvent.prev_hash === EXPECTED.event.prev_hash &&
    firstIssuanceEvent.hash === EXPECTED.event.hash &&
    firstIssuanceEvent.content.identifier_status === EXPECTED.event.identifier_status
  ), { expected: EXPECTED.event, observed: { tii: firstIssuanceEvent.tii, seq: firstIssuanceEvent.seq, prev_hash: firstIssuanceEvent.prev_hash, hash: firstIssuanceEvent.hash, identifier_status: firstIssuanceEvent.content.identifier_status } });
}

// Historical invariant: every tii.issued event strictly before the first
// production issuance (by seq) must remain identifier_status "test" —
// same invariant test/ledger-integrity.test.js enforces, re-derived here
// independently rather than assumed.
const issuedEvents = ledger.events.filter((e) => e.event_type === 'tii.issued');
const preAuthorizationTampered = issuedEvents.filter((e) => e.seq < EXPECTED.event.seq && e.content.identifier_status !== 'test');
check('no pre-authorization issuance was reclassified from test', preAuthorizationTampered.length === 0, { tampered: preAuthorizationTampered.map((e) => e.event_id) });

/* --------------------------------------------- 4. checkpoints, read-only --- */
const checkpointDir = path.join(REPO, 'checkpoints');
for (const known of EXPECTED.knownCheckpointFiles) {
  const filePath = path.join(checkpointDir, known.file);
  const exists = fs.existsSync(filePath);
  check(`known checkpoint file exists: ${known.file}`, exists, { path: filePath });
  if (!exists) continue;
  let verified;
  try {
    verified = checkpointStore.verifyCheckpoint(ledger, { dir: checkpointDir, file: known.file });
  } catch (e) {
    verified = { status: 'ERROR', error: e.message };
  }
  check(
    `known checkpoint verifies: ${known.file}`,
    verified.status === 'VERIFIED' && verified.key_id === EXPECTED.checkpointKeyId && verified.checkpoint.event_count === known.event_count && verified.checkpoint.ledger_head_hash === known.head_hash,
    { expected: known, observed: verified }
  );
}

/* --------------------------------------- 5. verification record consistency --- */
const recordPath = path.join(REPO, 'spec/verification/first-production-issuance-2026-09-17.json');
if (fs.existsSync(recordPath)) {
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  // Distinguish DOCUMENTED (what the record claims) from OBSERVED (what
  // this script independently recomputed above) — never treat the
  // record's own claims as verification of themselves.
  check('verification record: tag resolved commit matches independent observation', record.annotated_tag.resolved_commit_sha === EXPECTED.tagResolvedCommit, { documented: record.annotated_tag.resolved_commit_sha, observed: EXPECTED.tagResolvedCommit });
  check('verification record: first-issuance event hash matches independent observation', firstIssuanceEvent && record.ledger_verification.production_tii_issued_event.hash === firstIssuanceEvent.hash, { documented: record.ledger_verification.production_tii_issued_event.hash, observed: firstIssuanceEvent && firstIssuanceEvent.hash });
} else {
  check('verification record exists', false, { path: recordPath });
}

/* --------------------------------------------- 6. current state (report only) --- */
const currentState = {
  ledger_event_count: ledger.events.length,
  ledger_head_hash: chain.head_hash,
  total_tii_issued: issuedEvents.length,
  production_tii_count: issuedEvents.filter((e) => e.content.identifier_status === 'production').length,
  test_tii_count: issuedEvents.filter((e) => e.content.identifier_status === 'test').length,
  checkpoint_file_count: fs.existsSync(checkpointDir) ? fs.readdirSync(checkpointDir).filter((f) => f.startsWith('checkpoint-')).length : 0,
};
// Not asserted against a fixed expectation — reported for human review.
// A future, separately-authorized issuance is expected to change these
// numbers and that is not, by itself, a failure this script reports.

/* --------------------------------------------------------------- output --- */
console.log(JSON.stringify({ ok: !failed, checks: results, current_state_report_only: currentState }, null, 2));
process.exit(failed ? 1 : 0);
