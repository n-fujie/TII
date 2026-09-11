'use strict';

/**
 * Crash-safe append support: tolerant ledger parsing, the write-ahead journal
 * path, and non-destructive inspection. Production-hardening Phase 1 (P0-C),
 * spec/crash-recovery.md.
 *
 * The journal is operational recovery state, NOT canonical history:
 *  - it is never part of a TII identifier or its meaning,
 *  - it is safe to remove once its one event is confirmed committed,
 *  - an unfinished journal at load time STOPS writable mode and is reported —
 *    never silently discarded, never silently replayed.
 *
 * A malformed/truncated ledger TAIL is a different condition (corruption in
 * the canonical file itself, not the journal) and is handled the same way:
 * reported, not silently repaired. The bytes before the malformed point are
 * never altered by loading — only an explicit `tii recover truncate-tail`
 * (bin/tii.js) touches the file, and only after writing a backup + report.
 */

const fs = require('node:fs');

class RecoveryRequiredError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'RecoveryRequiredError';
    this.code = 'recovery-required';
    this.detail = detail;
  }
}

function journalPath(ledgerFile) {
  return ledgerFile + '.journal';
}

/** fsync a file's current contents to disk by path. */
function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse ledger JSONL text tolerantly. Returns `{ events, malformed }`.
 * `malformed` is null if every line parsed; otherwise it describes the FIRST
 * unparseable line and parsing stops there — everything before it is real,
 * everything at/after it is left untouched on disk and reported, not guessed.
 */
function parseLedgerTolerant(text) {
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end--; // tolerate exactly one trailing newline
  const events = [];
  let malformed = null;
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // tolerate stray blank lines (never written by append(), but harmless)
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      malformed = { line_number: i + 1, raw: line, error: e.message };
      break;
    }
  }
  return { events, malformed };
}

/**
 * Non-destructive diagnostic: what state is `<ledgerFile>` and its journal in?
 * Never writes anything.
 */
function inspect(ledgerFile) {
  const report = {
    ledger_file: ledgerFile,
    exists: fs.existsSync(ledgerFile),
    malformed_tail: null,
    last_valid_event: null,
    expected_next_seq: 0,
    journal: null,
    recovery_required: false,
  };
  if (report.exists) {
    const { events, malformed } = parseLedgerTolerant(fs.readFileSync(ledgerFile, 'utf8'));
    report.last_valid_event = events.length
      ? { event_id: events[events.length - 1].event_id, seq: events[events.length - 1].seq, hash: events[events.length - 1].hash }
      : null;
    report.expected_next_seq = events.length;
    report.malformed_tail = malformed;
  }
  const jPath = journalPath(ledgerFile);
  if (fs.existsSync(jPath)) {
    let journalEvent = null;
    let journalError = null;
    const raw = fs.readFileSync(jPath, 'utf8').trim();
    try {
      journalEvent = raw ? JSON.parse(raw) : null;
    } catch (e) {
      journalError = e.message;
    }
    // A journal event is "already committed" if the canonical ledger's last
    // valid event has the same event_id — the crash happened AFTER the ledger
    // write but BEFORE the journal was removed. Otherwise it was never
    // applied — the crash happened BEFORE (or during) the ledger write.
    const alreadyCommitted =
      journalEvent && report.last_valid_event && report.last_valid_event.event_id === journalEvent.event_id;
    report.journal = { path: jPath, parses: !!journalEvent, error: journalError, event: journalEvent, already_committed: !!alreadyCommitted };
  }
  report.recovery_required = !!(report.malformed_tail || report.journal);
  return report;
}

module.exports = { RecoveryRequiredError, journalPath, fsyncFile, parseLedgerTolerant, inspect };
