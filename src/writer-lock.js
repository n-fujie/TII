'use strict';

/**
 * Cross-process advisory write lock for the single-authoritative-writer model
 * (spec/single-writer-model.md, production-hardening Phase 1, P0-C).
 *
 * Same-host only — this is NOT a distributed lock and makes no claim beyond
 * "one OS process at a time may hold the canonical writer role for this
 * ledger file". A second writer process is refused (fail closed), never
 * merged with, never retried indefinitely.
 *
 * In-process concurrency needs none of this: Ledger.append() has no `await`
 * in its critical section, so concurrent async callers in ONE process already
 * serialize through the JS event loop. This module only matters across
 * process boundaries.
 */

const fs = require('node:fs');
const os = require('node:os');

class WriterLockedError extends Error {
  constructor(message, holder) {
    super(message);
    this.name = 'WriterLockedError';
    this.code = 'writer-locked';
    this.holder = holder;
  }
}

/** True if `pid` is a currently-running process (best effort, POSIX signal 0). */
function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = definitely no such process. Any other error (e.g. EPERM, a pid
    // owned by another user) is treated conservatively as "might be alive".
    return e.code !== 'ESRCH';
  }
}

function readLockHolder(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null; // missing, or a lock file mid-write by a racing process
  }
}

function writeLockFile(lockPath, extra = {}) {
  const fd = fs.openSync(lockPath, 'wx'); // O_EXCL — fails if the file already exists
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString(), ...extra }));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Acquire the writer lock for `ledgerFile` (creates `<ledgerFile>.lock`).
 *
 * - Held by a LIVE process → a small bounded synchronous retry budget, then
 *   WriterLockedError. No unbounded waiting, no best-effort concurrent write.
 * - Held by a DEAD process (its recorded pid is no longer running) → the lock
 *   is reclaimed. This is reported on the returned handle (`reclaimed: true`,
 *   `staleHolder`), never silent, and touches only the `.lock` file — never
 *   canonical ledger bytes.
 *
 * Returns `{ path, reclaimed, release() }`. Always call `release()` (use
 * try/finally) even on error paths that already hold the lock.
 */
function acquireWriterLock(ledgerFile, { retries = 8, retryDelayMs = 4 } = {}) {
  const lockPath = ledgerFile + '.lock';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      writeLockFile(lockPath);
      return { path: lockPath, reclaimed: false, release: () => releaseLock(lockPath) };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readLockHolder(lockPath);
      if (holder && !isProcessAlive(holder.pid)) {
        try {
          fs.unlinkSync(lockPath);
          writeLockFile(lockPath, { reclaimed_from: holder });
          return { path: lockPath, reclaimed: true, staleHolder: holder, release: () => releaseLock(lockPath) };
        } catch {
          // raced with another reclaimer/writer — fall through and retry
        }
      }
      if (attempt < retries) sleepSyncMs(retryDelayMs);
    }
  }

  const holder = readLockHolder(lockPath);
  throw new WriterLockedError(
    `writer lock is held${holder ? ` by pid ${holder.pid} on ${holder.host} since ${holder.acquired_at}` : ' (lock file present, holder unreadable)'
    } — refusing to write (single-authoritative-writer model; see spec/single-writer-model.md)`,
    holder
  );
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* already gone (e.g. reclaimed by a watchdog) — not an error to release twice */
  }
}

/** Synchronous sleep via Atomics.wait — keeps the writer critical section fully sync. */
function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* Atomics.wait unavailable in this runtime — skip the wait, retry immediately */
  }
}

module.exports = { acquireWriterLock, WriterLockedError, isProcessAlive };
