'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize, stripUndefined } = require('./canonical');
const { sha256, GENESIS_HASH } = require('./hash');
const { newTII, newEventId } = require('./id');
const { acquireWriterLock } = require('./writer-lock');
const { RecoveryRequiredError, journalPath, fsyncFile, parseLedgerTolerant } = require('./recovery');

/**
 * Append-only event ledger. The JSONL file is the record of authority (要件20).
 * Existing lines are never rewritten; corrections are new events that reference
 * the event they supersede (要件5).
 *
 * PRODUCTION-HARDENING PHASE 1 (P0-C, spec/single-writer-model.md,
 * spec/crash-recovery.md): every mutating call to this class within a single
 * OS process is additionally protected by:
 *   - a cross-process advisory writer lock (src/writer-lock.js) — the
 *     single-authoritative-writer model: one writer process at a time;
 *   - a write-ahead journal (`<file>.journal`, fsynced before the canonical
 *     append, removed only after the canonical append is itself fsynced) —
 *     an interrupted write is detectable and never silently accepted as an
 *     undamaged canonical ledger.
 * Neither mechanism changes the historical event format, hashing, or
 * canonicalization in any way — `verify()` and the on-disk JSONL are
 * unchanged for every event that predates this phase.
 */
class Ledger {
  constructor(file) {
    this.file = file;
    /** @type {object[]} */
    this.events = [];
    this._byEventId = new Map();
    this._issuedTII = new Set();
    this._idempotency = new Map();
    /** Set by load(); see src/recovery.js. Writes refuse while `required`. */
    this.recovery = { required: false, malformedTail: null, journal: null };
    /** Byte size of `file` as of the last load()/append(); see _resyncIfChanged(). */
    this._lastKnownSize = -1;
  }

  load() {
    this.events = [];
    this._byEventId.clear();
    this._issuedTII.clear();
    this._idempotency.clear();
    // `required` here gates writes IMMEDIATELY (no lock needed) and covers
    // only the malformed-tail case, which is a property of the ledger file's
    // own bytes and safe to act on without the writer lock. A leftover
    // journal file is NOT decided here — a concurrent legitimate writer can
    // transiently have a journal on disk mid-append, and deciding "orphaned"
    // requires holding the writer lock (see append()). `journalObservedAtLoad`
    // is informational only (used by status reporting), never a write gate.
    this.recovery = { required: false, malformedTail: null, journalObservedAtLoad: false };

    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8');
      const { events, malformed } = parseLedgerTolerant(raw);
      for (const ev of events) this._index(ev);
      if (malformed) {
        // A malformed/truncated tail STOPS writable mode. Reads still work on
        // the valid prefix — nothing on disk is altered by loading.
        this.recovery.required = true;
        this.recovery.malformedTail = malformed;
      }
    }
    this.recovery.journalObservedAtLoad = fs.existsSync(journalPath(this.file));
    this._lastKnownSize = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    return this;
  }

  /**
   * Re-read from disk ONLY if the file's byte size differs from what this
   * instance last knew (i.e. some other process wrote since our last
   * load()/append()). Correct because this is only ever called while holding
   * the exclusive writer lock: if the size matches, nobody else can be
   * concurrently changing it at this instant, so our in-memory state is
   * provably current. This keeps the common case (one long-lived writer
   * process) O(1) amortized per append instead of O(events) — full resync
   * only pays its cost when more than one process is actually contending.
   */
  _resyncIfChanged() {
    const currentSize = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    if (currentSize !== this._lastKnownSize) this.load();
  }

  _index(ev) {
    this.events.push(ev);
    this._byEventId.set(ev.event_id, ev);
    if (ev.event_type === 'tii.issued') this._issuedTII.add(ev.tii);
    if (ev.idempotency_key) this._idempotency.set(ev.idempotency_key, ev.event_id);
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

  /**
   * Look up a previously-recorded event by idempotency_key, with no side
   * effects. Returns the persisted event, or null if this key has never
   * been used. `_idempotency` is durably rebuilt from the persisted
   * `idempotency_key` field of every event on every load() (see _index()
   * above and the class doc's crash-recovery note) — not an in-memory-only
   * cache — so this survives process restart exactly like the rest of the
   * ledger's state.
   *
   * Exists so a CALLER (e.g. src/production-issuance.js) can resolve an
   * idempotent replay BEFORE doing any of its own work that must not be
   * repeated for a replay — generating a random candidate, checking it for
   * collision, signing a checkpoint — not only at append()-time, which is
   * too late for callers whose own pre-append work has side effects
   * (like drawing fresh randomness) that must never differ between a
   * request and its replay.
   */
  findByIdempotencyKey(key) {
    if (!key) return null;
    const eventId = this._idempotency.get(key);
    return eventId ? this.getEvent(eventId) : null;
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
   * finalized (要件28). Production issuance remains disabled at every call
   * site in this codebase — `identifier_status` is never anything but "test"
   * on any path that reaches this method today.
   *
   * `idempotency_key`, if given, is checked BEFORE a new token is minted: a
   * repeat with the SAME key AND the SAME content returns the original
   * (tii, event) pair instead of wasting/duplicating an issuance (要件25 of
   * production-hardening Phase 1). A repeat with the same key but DIFFERENT
   * content is a genuinely different request reusing the key — it fails
   * closed (spec/issuance-path-audit-2026-09-19.md's rehearsal finding: this
   * check used to compare only `event_type`, not `content`, so a caller
   * could silently receive a different request's result under the same key
   * with no error — the exact defect already found and fixed for
   * issueProductionTII() in the G6/G14 repair, mirrored here for the general
   * path). This pre-check exists (rather than relying solely on append()'s
   * own _validateAppend(), which performs the same content comparison) so a
   * confirmed replay never wastes a fresh candidate draw from newTII().
   */
  issueTII(opts = {}) {
    const {
      recorder,
      content = {},
      basis = [],
      external_refs = [],
      content_verification,
      identifier_status = 'test',
      idempotency_key,
    } = opts;

    const intendedContent = { ...content, identifier_status };

    if (idempotency_key) {
      const existingId = this._idempotency.get(idempotency_key);
      if (existingId) {
        const existing = this.getEvent(existingId);
        const same = existing.event_type === 'tii.issued' && canonicalize(existing.content || {}) === canonicalize(intendedContent);
        if (!same) {
          throw new Error(`idempotency_key "${idempotency_key}" was already used for a different operation`);
        }
        return { tii: existing.tii, event: existing, idempotent_replay: true };
      }
    }

    const tii = newTII((c) => this.tiiExists(c));
    const event = this.append({
      tii,
      event_type: 'tii.issued',
      recorder,
      content: intendedContent,
      basis,
      external_refs,
      content_verification,
      idempotency_key,
    });
    return { tii, event };
  }

  /**
   * Re-validate a candidate event against the CURRENT (just-resynced) ledger
   * state. Split out of append() because it must run twice: once optimistically
   * before the lock (cheap fail-fast), and once authoritatively after the
   * lock + resync (the check that actually matters for correctness).
   */
  _validateAppend(partial) {
    if (partial.idempotency_key) {
      const existingId = this._idempotency.get(partial.idempotency_key);
      if (existingId) {
        const existing = this.getEvent(existingId);
        const same =
          existing.tii === partial.tii &&
          existing.event_type === partial.event_type &&
          canonicalize(existing.content || {}) === canonicalize(partial.content ?? {});
        if (same) return existing; // idempotent replay: no new write, no duplicate
        throw new Error(`idempotency_key "${partial.idempotency_key}" was already used for a different operation`);
      }
    }
    if (partial.event_type !== 'tii.issued' && !this.tiiExists(partial.tii)) {
      throw new Error('unknown TII (issue it first): ' + partial.tii);
    }
    if (partial.event_type === 'tii.issued' && this.tiiExists(partial.tii)) {
      throw new Error('TII already issued: ' + partial.tii);
    }
    if (partial.supersedes && !this.eventExists(partial.supersedes)) {
      throw new Error('supersedes references unknown event: ' + partial.supersedes);
    }
    return undefined; // no idempotent replay found — proceed to build+write
  }

  /**
   * Append one event. Assigns event_id / seq / timestamps / prev links / hash.
   * `event_type` is a free string — unknown types are stored as-is (要件5, 23).
   *
   * Refuses (RecoveryRequiredError) while a malformed ledger tail was seen at
   * load() time. Otherwise: acquires the cross-process writer lock,
   * RE-SYNCS this instance's in-memory state from disk (so seq / prev_hash /
   * existence checks are correct even if another process wrote since this
   * instance's last load() — the single-authoritative-writer model constrains
   * who may *hold the lock and write*, not how many processes may *hold a
   * Ledger object*), checks for an orphaned journal, writes a fsynced
   * write-ahead journal entry, appends the fsynced canonical line, then
   * removes the journal — see class doc and spec/crash-recovery.md.
   */
  append(partial) {
    if (!partial || typeof partial !== 'object') throw new Error('event must be an object');
    if (!partial.tii) throw new Error('event requires "tii"');
    if (!partial.event_type || typeof partial.event_type !== 'string') {
      throw new Error('event requires string "event_type"');
    }
    if (!partial.recorder) throw new Error('event requires "recorder"');

    if (this.recovery && this.recovery.required) {
      throw new RecoveryRequiredError(
        'ledger requires explicit recovery before further writes — run `tii recover inspect`',
        this.recovery
      );
    }

    // Optimistic fail-fast check against whatever state this instance already
    // has (avoids acquiring the lock for an obviously-doomed call). This is
    // NOT the authoritative check — see below.
    const optimisticReplay = this._validateAppend(partial);
    if (optimisticReplay) return optimisticReplay;

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = acquireWriterLock(this.file);
    try {
      // AUTHORITATIVE journal check: now that we hold the exclusive writer
      // lock, a leftover journal file can only be orphaned — left by a writer
      // that crashed while holding this very lock. A legitimate concurrent
      // writer would itself be holding the lock, not us, so this check is
      // race-free (unlike a check performed at load() time, before any lock
      // is held). Never silently ignored or replayed — refuse and report.
      const jPath = journalPath(this.file);
      if (fs.existsSync(jPath)) {
        this.recovery.required = true;
        this.recovery.journal = jPath;
        throw new RecoveryRequiredError(
          'an orphaned write-ahead journal was found while holding the writer lock — a prior writer crashed mid-append; run `tii recover inspect`',
          this.recovery
        );
      }

      // AUTHORITATIVE resync: re-read the ledger IF another process changed it
      // since we last knew (see _resyncIfChanged doc). A no-op in the common
      // single-writer-process case.
      this._resyncIfChanged();
      if (this.recovery.required) {
        throw new RecoveryRequiredError(
          'ledger requires explicit recovery before further writes — run `tii recover inspect`',
          this.recovery
        );
      }
      const authoritativeReplay = this._validateAppend(partial);
      if (authoritativeReplay) return authoritativeReplay;

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
        idempotency_key: partial.idempotency_key,
        prev_event_for_target: prevForTarget ? prevForTarget.event_id : null,
        prev_hash: this.lastHash,
      });

      event.hash = sha256(event.prev_hash + canonicalize(omitKey(event, 'hash')));
      const line = JSON.stringify(event) + '\n';

      // 1) write-ahead: a fully-formed, fsynced journal entry — a crash before
      //    this point loses nothing (the mutation simply never happened).
      fs.writeFileSync(jPath, line);
      fsyncFile(jPath);

      // 2) the canonical append itself, fsynced.
      const fd = fs.openSync(this.file, 'a');
      try {
        fs.writeSync(fd, line);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      // 3) commit: the journal's only job was to survive a crash between (1)
      //    and (2); once (2) is durable, the journal is redundant and removed.
      //    A crash between (2) and (3) leaves a journal whose event is ALREADY
      //    in the ledger — `tii recover inspect` reports this as
      //    already_committed and recovery is a no-op removal, never a replay
      //    that could duplicate the event.
      fs.unlinkSync(jPath);

      this._index(event);
      this._lastKnownSize = fs.statSync(this.file).size;
      return event;
    } finally {
      lock.release();
    }
  }

  /**
   * Recompute the hash chain from scratch and report any tampering: rewritten
   * content, deleted lines, reordering (要件21). No blockchain involved.
   *
   * THIS PROVES INTERNAL CONSISTENCY ONLY — not authenticity, not that the
   * chain was never fully rewritten. A malicious actor with write access can
   * regenerate the entire chain from a forged event onward and this method
   * will still return `ok: true` (demonstrated in
   * test/checkpoint.test.js "full-chain forgery"). Detecting that requires an
   * independently held signed checkpoint — see src/checkpoint-store.js and
   * spec/checkpoint-operation.md §1 ("two distinct verification claims").
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
