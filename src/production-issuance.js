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
const { canonicalize } = require('./canonical');
const { IdempotencyConflictError } = require('./ledger');

class ProductionGateClosedError extends Error {
  constructor(status) {
    super('production issuance is not available — blocked by: ' + status.blocked_by.join(', '));
    this.name = 'ProductionGateClosedError';
    this.code = 'production-gate-closed';
    this.status = status;
  }
}

/**
 * Whether `existing` (a persisted tii.issued event) represents the SAME
 * logical issuance request as one that would produce `intendedContent` —
 * i.e. whether a retry under the same idempotency_key is a replay of this
 * exact request (return the original result) rather than a genuinely
 * different request reusing the same key (fail closed). Deliberately the
 * same two caller-controlled fields src/ledger.js's own _validateAppend()
 * already compares (event_type + content) — no new fingerprint semantics
 * invented; `tii` cannot be part of this comparison because it does not
 * exist yet for the pre-RNG check this function exists to support.
 */
function sameIssuanceIntent(existing, intendedContent) {
  return (
    !!existing &&
    existing.event_type === 'tii.issued' &&
    canonicalize(existing.content || {}) === canonicalize(intendedContent ?? {})
  );
}

/**
 * Read-only checkpoint status for an idempotent-replay result. A replay
 * must not create a checkpoint (§2.A: "no additional externally visible
 * mutation") — restoring checkpoint currency after some earlier failure is
 * the existing, separate `tii checkpoint create` operator recovery path
 * (spec/first-production-issuance-procedure.md step 17), not something a
 * replay call performs as a side effect.
 */
function readOnlyCheckpointStatus(ledger, checkpointDir) {
  try {
    const v = checkpointStore.verifyCheckpoint(ledger, { dir: checkpointDir });
    return {
      status: 'NOT_ATTEMPTED_REPLAY',
      reason: 'idempotent replay creates no new checkpoint',
      current_checkpoint_status: v.status,
      matches_current_head: v.matches_current_head === true,
    };
  } catch (e) {
    return { status: 'NOT_ATTEMPTED_REPLAY', reason: 'idempotent replay creates no new checkpoint', current_checkpoint_status: 'UNKNOWN', error: e.message };
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

  const intendedContent = { ...content, identifier_status: 'production' };

  // Idempotent replay MUST be resolved BEFORE any RNG, collision check,
  // ledger append, or checkpoint — never after (see
  // spec/production-launch-gate.md's "Pre-G9 final launch audit" note and
  // "G6/G14 idempotency repair" for why the old post-RNG check was wrong).
  // Not gated behind dryRun: dryRun's own branch below is unaffected and
  // still never touches durable state; this check only short-circuits the
  // REAL (non-dry-run) path, before dryRun is even inspected, so a caller
  // cannot bypass a real prior replay by passing dryRun=true.
  if (!dryRun && idempotency_key) {
    const existing = ledger.findByIdempotencyKey(idempotency_key);
    if (existing) {
      if (!sameIssuanceIntent(existing, intendedContent)) {
        throw new IdempotencyConflictError(`idempotency_key "${idempotency_key}" was already used for a different operation`, { idempotencyKey: idempotency_key });
      }
      return {
        tii: existing.tii,
        event: existing,
        gate_status: status,
        production_checkpoint: readOnlyCheckpointStatus(ledger, checkpointDir),
        idempotent_replay: true,
      };
    }
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
        content: intendedContent,
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

      return { tii: event.tii, event, gate_status: status, production_checkpoint };
    } catch (e) {
      if (/^TII already issued/.test(e.message)) continue; // authoritative candidate collision, discard and retry with a fresh candidate

      // A concurrent caller may have completed THIS exact logical request
      // (same idempotency_key, same intent) while we were drawing our own
      // (losing) candidate — the pre-RNG check above ran before their
      // append committed, so we didn't see it then. ledger.append()'s own
      // authoritative resync (inside the writer lock) means this ledger
      // instance's in-memory state is now current: resolve by re-checking,
      // not by assuming. If it now matches, this is a replay, not a
      // conflict — return the winner's result rather than propagating an
      // error to a caller who made the identical request. Discriminated by
      // error TYPE (proof a resync already happened inside append()), never
      // by parsing `.message` — see src/ledger.js's IdempotencyConflictError
      // doc comment for why a message string is not a stable signal.
      if (idempotency_key && e instanceof IdempotencyConflictError) {
        const existing = ledger.findByIdempotencyKey(idempotency_key);
        if (sameIssuanceIntent(existing, intendedContent)) {
          return {
            tii: existing.tii,
            event: existing,
            gate_status: status,
            production_checkpoint: readOnlyCheckpointStatus(ledger, checkpointDir),
            idempotent_replay: true,
          };
        }
      }
      throw e; // genuinely different intent under the same key, or any other error
    }
  }
  throw new Error('production issuance failed: collision retries exhausted (implausible at 128-bit entropy)');
}

module.exports = { issueProductionTII, ProductionGateClosedError };
