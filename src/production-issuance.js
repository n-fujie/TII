'use strict';

/**
 * Production TII issuance — GATED, CAPABLE, NOT EXECUTED.
 *
 * spec/production-launch-gate.md G2. This module connects the frozen TII
 * Identifier Syntax 1.0 generator (src/identifier.js, 128-bit / 26-char) to
 * a real append path, entirely separate from src/ledger.js's issueTII()
 * (which is the TEST path and always uses src/id.js's 12-character
 * generator). Every call into issueProductionTII() is checked against
 * src/production-gate.js's multi-condition gate FIRST; with this
 * repository's committed configuration the gate is always closed, so this
 * module can exist, be tested, and be exercised in dry-run mode without any
 * risk of a real production identifier being minted.
 *
 * NOT exposed over HTTP anywhere in this phase (spec/production-launch-gate.md
 * §0: "No externally visible production issuance endpoint may be enabled") —
 * only bin/tii.js's CLI calls this module, and the CLI itself still refuses
 * to execute a live issuance without the gate open (see bin/tii.js `issue
 * --production`).
 */

const identifierProd = require('./identifier');
const gate = require('./production-gate');
const checkpointStore = require('./checkpoint-store');

class ProductionGateClosedError extends Error {
  constructor(status) {
    super('production issuance is not available — blocked by: ' + status.blocked_by.join(', '));
    this.name = 'ProductionGateClosedError';
    this.code = 'production-gate-closed';
    this.status = status;
  }
}

/**
 * @param {import('./ledger').Ledger} ledger
 * @param {object} opts
 * @param {object} [opts.env]
 * @param {string} [opts.checkpointDir]
 * @param {boolean} [opts.dryRun] if true, never touches canonical history
 * @param {*} opts.recorder
 * @param {object} [opts.content]
 * @param {string} [opts.idempotency_key]
 */
function issueProductionTII(ledger, opts = {}) {
  const { env = process.env, checkpointDir, dryRun = false, recorder, content = {}, idempotency_key } = opts;

  const status = gate.computeGateStatus({ ledgerFile: ledger.file, checkpointDir, env });
  if (!status.available) {
    throw new ProductionGateClosedError(status);
  }

  // A candidate token is generated even in dry-run mode (so the operator can
  // see exactly what WOULD be minted), but it is NEVER checked for
  // uniqueness against the ledger, never reserved, and never written
  // anywhere — an ungated, unrecorded candidate carries no meaning and
  // cannot collide with anything because it was never entered into history.
  if (dryRun) {
    const candidateToken = identifierProd.generateIdentifier();
    return {
      dry_run: true,
      candidate_identifier: candidateToken,
      gate_status: status,
      would_append: {
        event_type: 'tii.issued',
        tii: candidateToken,
        recorder,
        content: { ...content, identifier_status: 'production' },
      },
      note: 'DRY RUN — nothing was appended, reserved, or published. This candidate identifier is ephemeral and MUST NOT be reused as if it had been issued.',
    };
  }

  // Real path (inert while the gate above is closed — which it always is in
  // this repository's committed configuration).
  //
  // Collision handling (spec/production-launch-gate.md §10): generate ->
  // canonical encode -> cheap optimistic uniqueness pre-check -> attempt the
  // append. ledger.append()'s own _validateAppend() re-checks uniqueness a
  // SECOND time, AUTHORITATIVELY, AFTER acquiring the writer lock and
  // resyncing from disk (src/ledger.js) — exactly the "inside the
  // authoritative write lock" check the task requires; this module does not
  // duplicate that logic, it relies on it. If that authoritative check finds
  // a collision (vanishingly unlikely at 128 bits, but handled exactly as
  // specified), append() throws "TII already issued" WITHOUT writing
  // anything — the collided candidate is discarded, never entering the
  // ledger, and a brand new candidate is drawn for the next attempt. Any
  // OTHER error (writer-locked, recovery-required, etc.) is not a collision
  // and is propagated immediately, not retried.
  const MAX_ATTEMPTS = 1000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = identifierProd.generateIdentifier();
    if (ledger.tiiExists(candidate)) continue; // optimistic pre-check; discard without ever touching append()
    try {
      const event = ledger.append({
        tii: candidate,
        event_type: 'tii.issued',
        recorder,
        content: { ...content, identifier_status: 'production' },
        idempotency_key,
      });

      // Checkpoint policy for production mutations (spec/production-launch-gate.md
      // §16/§17, G4): checkpoint after EVERY authoritative production
      // mutation, not best-effort-and-silent. The append above is already
      // durably committed (src/ledger.js fsyncs it) — "do not pretend the
      // write did not happen": if checkpoint creation fails here, the event
      // stays in canonical history exactly as written, and the FAILURE is
      // surfaced in the return value rather than hidden. The production
      // gate's `checkpoint_current` condition (src/production-gate.js) then
      // correctly blocks any FURTHER production mutation until an operator
      // restores checkpoint currency — this is what "disable further
      // production mutations... require operator recovery" means in
      // practice, without silently rolling back valid append-only history.
      let production_checkpoint;
      try {
        const created = checkpointStore.createCheckpoint(ledger, { dir: checkpointDir, env });
        production_checkpoint = { status: 'CREATED', file: created.file };
      } catch (e) {
        production_checkpoint = { status: 'FAILED', error: e.message, warning: 'the production mutation above IS committed to canonical history; further production mutations are blocked until checkpoint currency is restored (see production_checkpoint.status)' };
      }

      return { tii: candidate, event, gate_status: status, production_checkpoint };
    } catch (e) {
      if (/^TII already issued/.test(e.message)) continue; // authoritative collision, discard and retry
      throw e;
    }
  }
  throw new Error('production issuance failed: collision retries exhausted (implausible at 128-bit entropy)');
}

module.exports = { issueProductionTII, ProductionGateClosedError };
