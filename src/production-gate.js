'use strict';

/**
 * Production Launch Gate (spec/production-launch-gate.md). Computes whether
 * production TII issuance is currently AVAILABLE — and it is not, anywhere in
 * this repository's committed configuration.
 *
 * DESIGN RULE (spec/production-launch-gate.md §5–§8): no single environment
 * variable, and no single condition of any kind, may by itself authorize
 * production issuance. `TII_PRODUCTION_ISSUANCE_ENABLED=true` is necessary
 * but never sufficient — it is ANDed with several independent conditions
 * below, each of which reflects a real launch prerequisite (governance
 * resolved, resolver domain approved, IANA gate satisfied, a signing key
 * actually configured, the writer actually healthy, no recovery pending).
 * Every condition fails closed: absent, empty, or malformed input means
 * false, never true. None of them is ever inferred from NODE_ENV, hostname,
 * git branch, Vercel environment, or the mere presence of an admin token or
 * signing key being usable for something else.
 *
 * `admin_authenticated` is deliberately NOT part of this module — it is a
 * per-request fact (does THIS caller hold a valid admin token), checked by
 * the caller (bin/tii.js / a future HTTP route, if one is ever added) in
 * addition to, never instead of, everything here.
 */

const checkpointStore = require('./checkpoint-store');
const recovery = require('./recovery');
const { writerLockState } = require('./status');

/**
 * Strict boolean parse: TRUE only for the exact string "true". Everything
 * else — undefined, "", "false", "1", "TRUE", "yes", whitespace, garbage —
 * is FALSE. This is intentionally stricter than a truthy/falsy check so that
 * a malformed or unexpected value can never accidentally authorize anything.
 */
function strictBool(v) {
  return v === 'true';
}

/**
 * @param {object} opts
 * @param {string} opts.ledgerFile
 * @param {string} [opts.checkpointDir]
 * @param {object} [opts.env]
 * @returns {{available: boolean, conditions: Record<string, boolean>, blocked_by: string[], generated_at: string}}
 */
function computeGateStatus(opts = {}) {
  const { ledgerFile, checkpointDir, env = process.env } = opts;

  const production_requested = strictBool(env.TII_PRODUCTION_ISSUANCE_ENABLED);

  // TII Identifier Syntax 1.0 (spec/identifier-syntax-1.0-candidate.md,
  // frozen as a SPECIFICATION by this phase — see spec/production-launch-gate.md
  // §G1) is fixed and implemented (src/identifier.js). This condition is
  // about the SPEC being frozen, not about any other gate being satisfied.
  const identifier_profile_frozen = true;

  // None of the next three are things code can verify — they are governance,
  // legal, and registration facts. They are represented as explicit,
  // independently-set flags (never inferred), and default to false because
  // none of them is true today. See the referenced documents for exactly
  // what remains to make each one true.
  const governance_approved = strictBool(env.TII_GOVERNANCE_APPROVED); // spec/governance-candidate.md — legal entity status UNRESOLVED
  const resolver_approved = strictBool(env.TII_RESOLVER_APPROVED); // spec/resolver-domain-decision.md — no domain purchased
  const iana_gate_satisfied = strictBool(env.TII_IANA_GATE_SATISFIED); // spec/iana-provisional-registration.md — not submitted

  let signing_ready = false;
  try {
    signing_ready = !!checkpointStore.resolveSigningKey(env);
  } catch {
    signing_ready = false; // a malformed configured key fails closed, never throws out of the gate
  }

  let recovery_clear = false;
  let writer_healthy = false;
  try {
    const inspectReport = recovery.inspect(ledgerFile);
    recovery_clear = !inspectReport.recovery_required;
    const lockState = writerLockState(ledgerFile);
    writer_healthy = recovery_clear && lockState !== 'STALE_LOCK_PRESENT';
  } catch {
    recovery_clear = false;
    writer_healthy = false;
  }

  // PRODUCTION checkpoint-currency policy (spec/production-launch-gate.md
  // §16/§17, G4): the chosen policy is "checkpoint after every authoritative
  // production mutation". This condition enforces the safety half of that
  // policy in the gate itself: a production mutation is only allowed to
  // proceed if the LATEST checkpoint already matches the ledger's CURRENT
  // head. If a prior production mutation's checkpoint creation failed (or
  // was never attempted), the head has moved past the last checkpoint, this
  // is false, and further production mutations are refused until an
  // operator restores currency (e.g. `tii checkpoint create`, after fixing
  // whatever made signing fail) — matching "disable further production
  // mutations... require operator recovery" and "do not pretend the write
  // did not happen" (the earlier mutation is NOT rolled back; only FURTHER
  // mutations are blocked). With no signing key configured, signing_ready is
  // already false and blocks separately; with a key but no checkpoint yet
  // (e.g. brand new deployment, before the pre-issuance checkpoint in
  // spec/first-production-issuance-procedure.md step 10), this is also
  // false — production mutation requires a checkpoint to already be current,
  // never the other way around.
  let checkpoint_current = false;
  if (signing_ready) {
    try {
      const { Ledger } = require('./ledger');
      const ledgerForCheck = new Ledger(ledgerFile).load();
      const ckptStatus = checkpointStore.verifyCheckpoint(ledgerForCheck, { dir: checkpointDir, env });
      checkpoint_current = ckptStatus.status === 'VERIFIED' && ckptStatus.matches_current_head === true;
    } catch {
      checkpoint_current = false;
    }
  }

  const conditions = {
    production_requested,
    identifier_profile_frozen,
    governance_approved,
    resolver_approved,
    iana_gate_satisfied,
    signing_ready,
    writer_healthy,
    recovery_clear,
    checkpoint_current,
  };

  const blocked_by = Object.entries(conditions)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    available: blocked_by.length === 0,
    conditions,
    blocked_by,
    generated_at: new Date().toISOString(),
    note: 'admin_authenticated is a separate, per-request check made by the caller, not included here.',
  };
}

module.exports = { computeGateStatus, strictBool };
