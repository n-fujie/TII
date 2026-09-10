'use strict';

/**
 * Recompute "the record currently interpreted as valid" from the append-only
 * event stream (要件5, 15, 18, 24).
 *
 * Principles enforced here:
 *  - No fixed "current state" is assumed to always exist. Modules with no
 *    records are simply absent from the output.
 *  - Superseded events stay in history; they are only excluded from the
 *    current reading.
 *  - The system does not derive a single "correct ontological conclusion" from
 *    evidence. It reports what recorders asserted and what was disputed.
 */

function eventView(e) {
  const c = e.content || {};
  return {
    event_id: e.event_id,
    seq: e.seq,
    event_type: e.event_type,
    recorded_at: e.recorded_at,
    ledger_written_at: e.ledger_written_at,
    recorder: e.recorder,
    module: c.module ?? null,
    ref: c.ref ?? null,
    act: c.act ?? null,
    content: c,
    basis: e.basis || [],
    external_refs: e.external_refs || [],
    content_verification: e.content_verification || null,
    supersedes: e.supersedes ?? null,
    prev_event_for_target: e.prev_event_for_target ?? null,
    prev_hash: e.prev_hash,
    hash: e.hash,
  };
}

const TII_LIFECYCLE_TYPES = new Set([
  'tii.suspended',
  'tii.retracted',
  'tii.reinstated',
  'tii.made-nonpublic',
]);

const WITHDRAWING_ACTS = new Set(['withdraw', 'stop']);

function project(events) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const issued = ordered.find((e) => e.event_type === 'tii.issued') || null;

  const supersededBy = new Map();
  for (const e of ordered) {
    if (e.supersedes) supersededBy.set(e.supersedes, e.event_id);
  }

  const modules = {}; // module -> ref -> { module, ref, records: [], current, disputed, withdrawn }
  const disputes = [];
  const corrections = [];
  const interpretation = [];
  const lifecycle = [];
  const externalIdentifierEvents = [];
  let identifierStatus = issued && issued.content ? issued.content.identifier_status || 'test' : 'test';

  for (const e of ordered) {
    const view = eventView(e);
    const c = e.content || {};

    if (c.identifier_status) identifierStatus = c.identifier_status;
    if (e.event_type === 'interpretation.revised') interpretation.push(view);
    if (TII_LIFECYCLE_TYPES.has(e.event_type)) lifecycle.push(view);
    if (e.supersedes) corrections.push(view);
    if (e.event_type === 'dispute.raised') disputes.push(view);

    const mod = c.module;
    if (mod) {
      const ref = c.ref || e.event_id;
      if (!modules[mod]) modules[mod] = {};
      if (!modules[mod][ref]) {
        modules[mod][ref] = { module: mod, ref, records: [], current: null, disputed: false, withdrawn: false };
      }
      modules[mod][ref].records.push(view);
      if (c.act === 'dispute' || e.event_type.endsWith('.disputed')) {
        disputes.push({ ...view, module: mod, ref });
      }
      if (mod === 'external_identifier') externalIdentifierEvents.push(view);
    }
  }

  // Compute the current reading per module/ref.
  for (const mod of Object.keys(modules)) {
    for (const ref of Object.keys(modules[mod])) {
      const bucket = modules[mod][ref];
      const live = bucket.records.filter((r) => !supersededBy.has(r.event_id));
      const lastLive = live[live.length - 1] || null;
      const isWithdrawing = (r) =>
        !!r && (WITHDRAWING_ACTS.has(r.act) || r.event_type.endsWith('.withdrawn'));

      // The current reading is the most recent live record — UNLESS it retracts
      // the description (withdraw / stop), in which case there is no current
      // reading until something re-introduces it. No fixed "current state" is
      // assumed to always exist (要件15, 24).
      bucket.current = isWithdrawing(lastLive) ? null : lastLive;
      bucket.withdrawn = isWithdrawing(lastLive);
      bucket.disputed = bucket.records.some(
        (r) => r.act === 'dispute' || r.event_type.endsWith('.disputed')
      );
    }
  }

  // External references: from event.external_refs plus the external_identifier module.
  const references = [];
  for (const e of ordered) {
    for (const r of e.external_refs || []) {
      references.push({
        source: 'external_refs',
        ref: r,
        recorded_at: e.recorded_at,
        recorder: e.recorder,
        event_id: e.event_id,
      });
    }
  }
  for (const v of externalIdentifierEvents) {
    references.push({
      source: 'external_identifier',
      scheme: v.content.scheme || null,
      value: v.content.value || null,
      status: v.act || v.content.status || null,
      description: v.content.description || null,
      recorded_at: v.recorded_at,
      recorder: v.recorder,
      event_id: v.event_id,
    });
  }

  const last = ordered[ordered.length - 1] || null;
  const currentLifecycle = lifecycle.length ? lifecycle[lifecycle.length - 1] : null;

  return {
    tii: issued ? issued.tii : (ordered[0] ? ordered[0].tii : null),
    exists: !!issued,
    identifier_status: identifierStatus,
    lifecycle_state: currentLifecycle ? currentLifecycle.event_type : 'active',
    issued: issued ? eventView(issued) : null,
    interpretation,
    lifecycle,
    disputes,
    corrections,
    superseded_event_ids: [...supersededBy.keys()],
    references,
    last_recorded_at: last ? last.recorded_at : null,
    event_count: ordered.length,
    modules: Object.fromEntries(
      Object.entries(modules).map(([m, refs]) => [m, Object.values(refs)])
    ),
    events: ordered.map(eventView),
    disclaimer:
      'TII does not by itself guarantee essential identity, ownership, authenticity, ' +
      'academic legitimacy, or permanence. state / transition / ignition / address / ' +
      'domain / boundary / series are revisable operational descriptions, not ontological units.',
  };
}

module.exports = { project, eventView };
