'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize, stripUndefined } = require('./canonical');
const { sha256, GENESIS_HASH } = require('./hash');
const { newTII, newEventId } = require('./id');

/**
 * Append-only event ledger. The JSONL file is the record of authority (要件20).
 * Existing lines are never rewritten; corrections are new events that reference
 * the event they supersede (要件5).
 */
class Ledger {
  constructor(file) {
    this.file = file;
    /** @type {object[]} */
    this.events = [];
    this._byEventId = new Map();
    this._issuedTII = new Set();
  }

  load() {
    this.events = [];
    this._byEventId.clear();
    this._issuedTII.clear();
    if (!fs.existsSync(this.file)) return this;
    const raw = fs.readFileSync(this.file, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const ev = JSON.parse(trimmed);
      this._index(ev);
    }
    return this;
  }

  _index(ev) {
    this.events.push(ev);
    this._byEventId.set(ev.event_id, ev);
    if (ev.event_type === 'tii.issued') this._issuedTII.add(ev.tii);
  }

  get lastHash() {
    return this.events.length ? this.events[this.events.length - 1].hash : GENESIS_HASH;
  }

  get nextSeq() {
    return this.events.length;
  }

  tiiExists(tii) {
    return this._issuedTII.has(tii);
  }

  eventExists(id) {
    return this._byEventId.has(id);
  }

  getEvent(id) {
    return this._byEventId.get(id) || null;
  }

  listTIIs() {
    return [...this._issuedTII];
  }

  forTII(tii) {
    return this.events.filter((e) => e.tii === tii);
  }

  _lastEventForTII(tii) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].tii === tii) return this.events[i];
    }
    return null;
  }

  /**
   * Issue a new TII. The only guaranteed meaning: "tracking started from this
   * reference point" (要件3). All identifiers are `test` until SPEC.md §3 is
   * finalized (要件28).
   */
  issueTII(opts = {}) {
    const {
      recorder,
      content = {},
      basis = [],
      external_refs = [],
      content_verification,
      identifier_status = 'test',
    } = opts;
    const tii = newTII((c) => this.tiiExists(c));
    const event = this.append({
      tii,
      event_type: 'tii.issued',
      recorder,
      content: { ...content, identifier_status },
      basis,
      external_refs,
      content_verification,
    });
    return { tii, event };
  }

  /**
   * Append one event. Assigns event_id / seq / timestamps / prev links / hash.
   * `event_type` is a free string — unknown types are stored as-is (要件5, 23).
   */
  append(partial) {
    if (!partial || typeof partial !== 'object') throw new Error('event must be an object');
    if (!partial.tii) throw new Error('event requires "tii"');
    if (!partial.event_type || typeof partial.event_type !== 'string') {
      throw new Error('event requires string "event_type"');
    }
    if (!partial.recorder) throw new Error('event requires "recorder"');
    if (partial.event_type !== 'tii.issued' && !this.tiiExists(partial.tii)) {
      throw new Error('unknown TII (issue it first): ' + partial.tii);
    }
    if (partial.event_type === 'tii.issued' && this.tiiExists(partial.tii)) {
      throw new Error('TII already issued: ' + partial.tii);
    }
    if (partial.supersedes && !this.eventExists(partial.supersedes)) {
      throw new Error('supersedes references unknown event: ' + partial.supersedes);
    }

    const prevForTarget = this._lastEventForTII(partial.tii);
    const nowIso = new Date().toISOString();

    const event = stripUndefined({
      event_id: newEventId((c) => this.eventExists(c)),
      tii: partial.tii,
      seq: this.nextSeq,
      recorded_at: partial.recorded_at || nowIso,
      ledger_written_at: nowIso,
      recorder: normalizeRecorder(partial.recorder),
      event_type: partial.event_type,
      content: partial.content ?? {},
      basis: partial.basis ?? [],
      external_refs: partial.external_refs ?? [],
      content_verification: partial.content_verification,
      supersedes: partial.supersedes,
      prev_event_for_target: prevForTarget ? prevForTarget.event_id : null,
      prev_hash: this.lastHash,
    });

    event.hash = sha256(event.prev_hash + canonicalize(omitKey(event, 'hash')));

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf8');
    this._index(event);
    return event;
  }

  /**
   * Recompute the hash chain from scratch and report any tampering: rewritten
   * content, deleted lines, reordering (要件21). No blockchain involved.
   */
  verify() {
    let prev = GENESIS_HASH;
    const problems = [];
    this.events.forEach((ev, i) => {
      if (ev.seq !== i) {
        problems.push({ index: i, event_id: ev.event_id, issue: `seq ${ev.seq} != position ${i}` });
      }
      if (ev.prev_hash !== prev) {
        problems.push({ index: i, event_id: ev.event_id, issue: 'prev_hash does not match previous event hash' });
      }
      const recomputed = sha256(ev.prev_hash + canonicalize(omitKey(ev, 'hash')));
      if (recomputed !== ev.hash) {
        problems.push({ index: i, event_id: ev.event_id, issue: 'content hash mismatch (event body altered)' });
      }
      prev = ev.hash;
    });
    return { ok: problems.length === 0, event_count: this.events.length, head_hash: this.lastHash, problems };
  }
}

function normalizeRecorder(recorder) {
  if (typeof recorder === 'string') return { id: recorder, kind: 'unspecified' };
  if (recorder && typeof recorder === 'object') {
    return { kind: 'unspecified', ...recorder, id: recorder.id || 'unspecified' };
  }
  return { id: 'unspecified', kind: 'unspecified' };
}

function omitKey(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

module.exports = { Ledger, normalizeRecorder };
