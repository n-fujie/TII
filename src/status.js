'use strict';

/**
 * §35 of production-hardening Phase 1: independently-reportable operational
 * states. NEVER compress these into one "healthy" boolean — spec §10 of
 * spec/production-hardening-phase1.md and the audit page both surface each
 * one separately.
 */

const fs = require('node:fs');
const { Ledger } = require('./ledger');
const recovery = require('./recovery');
const checkpointStore = require('./checkpoint-store');
const { isProcessAlive } = require('./writer-lock');

function writerLockState(ledgerFile) {
  const lockPath = ledgerFile + '.lock';
  if (!fs.existsSync(lockPath)) return 'AVAILABLE';
  try {
    const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return isProcessAlive(holder.pid) ? 'LOCKED' : 'STALE_LOCK_PRESENT';
  } catch {
    return 'LOCKED'; // unreadable lock file — conservatively report locked, not available
  }
}

/**
 * @param {object} opts
 * @param {string} opts.ledgerFile
 * @param {string} [opts.checkpointDir]
 * @param {boolean} [opts.adminTokenConfigured]
 * @param {object} [opts.env]
 */
function getOperationalStatus(opts = {}) {
  const { ledgerFile, checkpointDir, adminTokenConfigured = false, env = process.env } = opts;

  const inspectReport = recovery.inspect(ledgerFile);

  let ledger = null;
  let verifyResult = { ok: false, error: 'ledger unavailable' };
  try {
    ledger = new Ledger(ledgerFile).load();
    verifyResult = ledger.verify();
  } catch (e) {
    verifyResult = { ok: false, error: e.message };
  }

  let checkpointStatus;
  try {
    checkpointStatus = ledger
      ? checkpointStore.verifyCheckpoint(ledger, { dir: checkpointDir })
      : { status: 'MISSING', reason: 'ledger unavailable' };
  } catch (e) {
    checkpointStatus = { status: 'INVALID', reason: e.message };
  }

  const writerState = inspectReport.recovery_required ? 'BLOCKED' : writerLockState(ledgerFile);

  return {
    generated_at: new Date().toISOString(),
    // A. internal chain integrity — VALID/INVALID. Never renamed "Verified".
    ledger_chain_integrity: verifyResult.ok ? 'VALID' : 'INVALID',
    ledger_chain_detail: verifyResult,
    // B. signed checkpoint — VERIFIED/UNVERIFIED/MISSING/INVALID. A separate claim.
    signed_checkpoint: checkpointStatus,
    checkpoint_signing_key_configured: !!checkpointStore.resolveSigningKey(env),
    writer_availability: writerState,
    admin_availability: adminTokenConfigured ? 'ENABLED' : 'DISABLED',
    recovery_required: inspectReport.recovery_required,
    recovery_detail: inspectReport.recovery_required ? inspectReport : undefined,
    // Restated on every status response: production issuance is disabled at
    // every code path in this repository, regardless of any of the above.
    production_issuance: 'DISABLED',
  };
}

module.exports = { getOperationalStatus, writerLockState };
