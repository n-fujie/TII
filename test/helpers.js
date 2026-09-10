'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Ledger } = require('../src/ledger');

function freshLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-test-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);
  ledger.load();
  ledger._dir = dir;
  return ledger;
}

function withTII(recorder = 'tester') {
  const ledger = freshLedger();
  const { tii } = ledger.issueTII({ recorder });
  return { ledger, tii };
}

/** Deep snapshot of every event currently in the ledger. */
function snapshot(ledger) {
  return JSON.parse(JSON.stringify(ledger.events));
}

/**
 * Assert the core invariant of TII: issuing a TII and adding records never
 * changes the identifier string, never loses or rewrites a past event, and the
 * hash chain stays intact. Only additive re-description is allowed.
 */
function assertHistoryPreserved(ledger, tii, before) {
  const assert = require('node:assert/strict');
  // 1. every earlier event is still present, byte-for-byte identical
  for (const prior of before) {
    const now = ledger.getEvent(prior.event_id);
    assert.ok(now, `event ${prior.event_id} must still exist`);
    assert.deepEqual(now, prior, `event ${prior.event_id} must be unchanged`);
  }
  // 2. the ledger only grew
  assert.ok(ledger.events.length >= before.length, 'event count must not shrink');
  // 3. chain integrity
  assert.ok(ledger.verify().ok, 'hash chain must verify');
  // 4. the TII string is still issued and unchanged
  assert.ok(ledger.tiiExists(tii), 'TII must still be issued');
}

module.exports = { freshLedger, withTII, snapshot, assertHistoryPreserved };
