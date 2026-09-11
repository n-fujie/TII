# TII Capability-Boundary + Adversarial System Audit

Empirical audit of what the Transition-Ignition Identifier implementation can
**actually** do, run against the code — not against the specification.

- **Date:** 2026-09-11 · **Commit audited:** `1f16af6`
- **Method:** every PASS is backed by an executed test in this repo's audit
  harness (`spec/audit/`). Nothing is graded from documentation.
- **Production issuance: DISABLED throughout.** All identifiers created during
  the audit were `identifier_status: "test"` in isolated temp ledgers.

## Baseline (before + after — §48)

| | value |
|---|---|
| git commit | `1f16af6b894483fbcbdfe7f3d441a12017998d7f` |
| `data/ledger.jsonl` md5 | `fb56b2a4a2f5fe134f3fa23e2186e7d1` (**unchanged before and after**) |
| ledger event count | 10 (**unchanged**) |
| ledger head hash | `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95` (**unchanged**) |
| `verify()` | `{ ok: true }` (**unchanged**) |
| issued identifiers | `tii:h4r3jsn4p25d` — the only one; still `test` (**unchanged**) |
| production issuance | **disabled** (`src/id.js` unchanged; `identifier_status` hard-set to `"test"` in `src/ledger.js:92`; no production code path exists) |
| existing test suite | 106 pass, 0 fail (**unchanged**) |
| candidate code | `src/candidate/*` imported by nothing on the live path (**unchanged**) |

All destructive / scale / concurrency tests ran on `fs.mkdtemp` copies.
`data/ledger.jsonl` was never opened for writing by the audit.

---

## The three system layers

| Layer | What it is | In this audit |
|---|---|---|
| **A — Current live core** | `src/ledger.js`, `src/projection.js`, `src/export.js`, `src/server.js`, `src/id.js`, `src/views.js`, `bin/tii.js`. The code the running service uses. | tested directly |
| **B — Candidate production components** | `src/candidate/identifier.js`, `src/candidate/jcs.js`, `src/candidate/checkpoint.js`. Testable, **imported by nothing on the live path.** | tested + labelled **CANDIDATE ONLY** |
| **C — Specification-only** | Privacy model, signed-checkpoint publication, stewardship-transfer workflow, mirror protocol, permanent domain, IANA registration, governance. Described in `spec/*`, **not implemented.** | reported as **SPECIFICATION ONLY / NOT IMPLEMENTED** |

**B and C are never reported as a live capability.**

---

## Capability matrix

Machine-readable: [`capability-matrix.json`](capability-matrix.json) (34 rows,
every PASS backed by an executed test). Summary:

| Status | Count |
|---|---|
| PASS | 24 |
| PARTIAL | 5 |
| FAIL | 2 |
| NOT IMPLEMENTED | 1 |
| CANDIDATE ONLY | 2 |

| # | Capability | Status | Layer | Arch change needed | Blocks launch |
|---|---|---|---|---|---|
| §4 | Basic issuance (issue→append→resolve→JSON→registry→export→static→verify) | **PASS** | A | no | no |
| §5 | Minimal record — TII with no state/transition/ignition/address/domain/boundary/lineage/owner/doc-type | **PASS** | A | no | no |
| §6 | Open vocabulary — unknown `event_type` / `module` / `act` survive everything | **PASS** | A | no | no |
| §7 | Record revision — A→B→contest→supersede→withdraw; nothing overwritten | **PASS** | A | no | no |
| §8 | Ignition optionality (0 / 1 / full lifecycle / reclassify as wrong vocabulary) | **PASS** | A | no | no |
| §9 | Transition optionality (same) | **PASS** | A | no | no |
| §10 | State non-primitivity — A/B + transition then rejected for a continuous-process reading | **PASS** | A | no | no |
| §11 | Address / Domain — independent; 1/many/none/unreachable/replaced/competing | **PASS** | A | no | no |
| §12 | Mirror — multiple locations; primary lost; no re-issuance | **PASS** | A | no | no |
| §13 | Content hash — digest change ≠ identity change; equal hashes don't merge TIIs | **PASS** | A | no | no |
| §14 | Series / lineage as a revisable judgement | **PASS** | A | no | no |
| §15 | Branch / merge — ancestry preserved; **no graph engine**; cycles neither detected nor forbidden | **PASS** | A | no | no |
| §16 | Ownership decomposition — no owner field; overlapping/conflicting relations | **PASS** | A | no | no |
| §17 | Stewardship transfer | **PARTIAL** | A storage / C workflow | no | no |
| §18 | Localization stress — 4 languages, correction, annotation; authored immutable; new language needs no migration | **PASS** | A | no | no |
| §19 | External identifiers — coexist, disappear, unknown types; TII not subordinate | **PASS** | A | no | no |
| §36 | Non-scholarly objects — 8 structurally different kinds, one thin core | **PASS** | A | no | no |
| §37 | "No object" — trace a disputed reference with no permanent object field | **PASS** | A | no | no |
| §38 | Category removal — withdraw a classification; history stays parsable | **PASS** | A | no | no |
| §39 | Audit-of-the-audit — audit judgments are themselves corrigible; no privileged "final" | **PASS** | A | no | no |
| §40 | **Privacy boundary** — content that should not be public | **NOT IMPLEMENTED** | C | yes | **yes** |
| §21 | Input security — code-shaped content cannot execute or corrupt output | **PASS** | A | no | no |
| §22/§23 | Candidate 26-char identifier — generation, round-trip, canonical form, rejections, distribution, collision-retry | **CANDIDATE ONLY** | B | (wiring) | (for prod syntax) |
| §24 | Candidate Ed25519 + RFC 8785 JCS signed checkpoints | **CANDIDATE ONLY** | B | (wiring) | **yes** (see §26) |
| §25 | Ledger tampering detection (single edits / delete / reorder / dup / hash edits) | **PASS** | A | no | no |
| §26 | **Full-chain regeneration attack — verify() alone cannot detect a recomputed forged chain** | **FAIL** | A | yes | **yes** |
| §27 | Crash consistency — partial write bricks load(); duplicate requests double-record | **PARTIAL** | A | yes | **yes** |
| §28 | **Concurrency — multiple OS processes writing one ledger corrupt it** | **FAIL** | A | yes | **yes** (for a writable multi-instance deployment) |
| §29 | Clock behaviour — order is seq-based (safe); timestamps unvalidated (display only) | **PASS** | A | no | no |
| §30/§31 | Scale & large payloads — O(events), all in memory, full rebuilds | **PARTIAL** | A | yes (for large scale) | no (at current scale) |
| §32 | Reconstruction from exports alone — zero deps, no service state | **PASS** | A | no | no |
| §33 | Hosting loss (Vercel disappears) | **PASS** | A | no | no |
| §34 | Domain loss model | **PARTIAL** | A / C | no | (governance) |
| §35 | Complete operator loss | **PARTIAL** | A records / C trust anchor + custody | yes (checkpoints) | **yes** |

---

## KNOWN FAILURES AND LIMITATIONS

Not euphemised. Each: reproduction, impact, data-integrity effect, launch
status, minimal repair class. **No repair implemented** (§49) — repairs are
proposed only.

### F-1 — `verify()` cannot detect a full-chain rewrite (§26) — **BLOCKER**

- **Reproduce:** `node spec/audit/adversarial-audit.js` → section §26. Take a
  copy of any ledger, change event #2's content, recompute `prev_hash` + `hash`
  for every later event with the real `src/canonical.js` + `src/hash.js`, write
  it back. `new Ledger(forged).load().verify()` returns `{ ok: true,
  problems: [] }`.
- **Impact:** the SHA-256 chain proves *internal consistency*, not
  *authenticity* or *non-rewriting*. Anyone who can write `ledger.jsonl` (or who
  serves a copy of it) can rewrite history in a way that `verify()` — the only
  integrity tool on the live path — accepts. A recipient of an exported ledger
  cannot tell a genuine one from a forged one.
- **Data integrity:** the *canonical* ledger is only as safe as write-access
  control to one file. There is no external anchor.
- **Launch:** BLOCKER for a production public identifier infrastructure.
- **Minimal repair class:** wire the **existing candidate** signed-checkpoint
  code (`src/candidate/checkpoint.js`, Ed25519 + RFC 8785 JCS — tested, §24)
  into the live path: publish a signed checkpoint over the head hash after each
  batch of writes, to ≥2 independent locations (git tag, archive). A verifier
  holding any checkpoint detects the forgery (demonstrated: the forged head
  `791f99b7…` ≠ the attested head `2b536995…`). This is wiring + key custody,
  not new cryptography.

### F-2 — the JSONL ledger is single-writer only (§28) — **BLOCKER for multi-instance writes**

- **Reproduce:** `node spec/audit/concurrency-audit.js`. 2 processes each
  appending 10 events to the same file → 10 duplicate seq numbers, 18
  `prev_hash` chain breaks, `verify()` fails. 100 processes → 469 duplicate
  seqs, 396 chain breaks.
- **Impact:** `append()` reads `nextSeq` / `lastHash` from the in-memory array
  then `fs.appendFileSync`s. Two OS processes both read seq N, both compute the
  same `prev_hash`, both write. There is no file lock, lock file,
  compare-and-swap, or transaction. In-process concurrency **is** safe
  (`append()` has no `await`).
- **Data integrity:** catastrophic under concurrent writers — corrupt chain,
  lost updates.
- **Launch:** the current production deployment is a **read-only static mirror
  (zero writes)**, so it is not affected *today*. But any writable deployment on
  more than one instance corrupts the ledger. A production registry that accepts
  writes needs this fixed.
- **Minimal repair class:** a single-writer constraint made explicit — an
  advisory lock file / `O_EXCL` lock, or funnel all writes through one process /
  a queue, or move the append path to a store with atomic append + CAS. The
  read/resolve/export paths are already safe and can scale horizontally.

### F-3 — no privacy mechanism; everything written is public (§40) — **BLOCKER for any non-public data**

- **Reproduce:** `node spec/audit/capability-audit.js` → §40. Append an event
  with `content.disclosure: "restricted"` and a secret string. The hint is
  ignored. The secret appears in: canonical JSONL, JSON export, CSV export,
  resolution HTML, the static site, and the projection/API shape.
- **Impact:** there is no `disclosure` handling, no commitment/redaction
  mechanism, no read access control. Anything in an event is world-readable on
  every surface.
- **Data integrity:** not affected — this is a confidentiality gap.
- **Launch:** BLOCKER if any production record could contain personal data,
  embargoed material, or a security-sensitive address. The model is specified
  (`identifier-syntax-1.0-candidate.md` §24) but not built.
- **Minimal repair class:** implement the specified model — a `disclosure`
  classification; for non-public payloads store a salted-hash commitment +
  non-sensitive metadata in the ledger and hold the payload out-of-band;
  redaction as an appended event. Deferred by instruction.

### F-4 — a partial/interrupted write makes the whole ledger unloadable (§27) — **HIGH**

- **Reproduce:** append `{"event_id":"evt_x","seq":5,"recorded` (a truncated
  line) to a ledger, then `new Ledger(file).load()` → throws
  `Unterminated string in JSON`. The entire ledger fails to load.
- **Impact:** `fs.appendFileSync` is not atomic for large lines / under a crash
  mid-syscall / disk full. `load()` does `JSON.parse` per line with no
  tolerance for a bad final line. No `fsync`, no atomic rename, no
  write-ahead, no tail recovery. `verify()` is not run on load.
- **Data integrity:** the last complete write and everything before it is
  intact on disk but inaccessible until someone manually truncates the partial
  line.
- **Launch:** HIGH for a writable deployment.
- **Minimal repair class:** write to a temp file + `fsync` + atomic
  `rename` per append (or an append + `fsync` + a "last good offset" marker), and
  make `load()` tolerate/quarantine a malformed trailing line instead of
  throwing.

### F-5 — client retries silently double-record (§27) — **MEDIUM**

- **Reproduce:** call `ledger.append(sameBody)` twice → two events, different
  `event_id`/`seq`/`hash`, identical content. `POST /api/tii/:id/events` twice →
  two events.
- **Impact:** no idempotency key / request id / dedup. A client that retries
  after a lost HTTP response records the event twice.
- **Launch:** MEDIUM.
- **Minimal repair class:** accept an optional client `idempotency_key`; on a
  repeat, return the existing event instead of appending.

### F-6 — scale: O(events), fully in memory, full rebuilds (§30/§31) — **MEDIUM (deferred)**

- **Measured** (`spec/performance-results.json`): at 10,000 TIIs / 50,000
  events — registry render **7.1 s**, `rebuild-static` **10.8 s** (40,012
  files), ledger **26 MB**, heap **+136 MB**. A 10 MB inline payload → a
  19.5 MB resolution HTML page.
- **Impact:** `Ledger.events` holds every event in RAM; `forTII` is a linear
  scan; the registry page projects every TII on every request; `rebuild-static`
  is always a full rebuild; startup re-parses the whole file. Projected: ~260 MB
  ledger at 100k events; ~13 GB heap at 1M TIIs. Does not fit a serverless
  function or a small VM at large scale.
- **Launch:** not a blocker at expected early scale (hundreds–thousands). A
  blocker for "a large public registry".
- **Minimal repair class:** an on-disk index (TII → byte offsets), pagination,
  incremental static build, streaming export, and a hard cap on inline payload
  size with a "reference large evidence, don't inline it" rule (already the
  spec's intent).

### L-7 — stewardship transfer is storage-only (§17) — **MEDIUM (governance)**

- Transfers are fully recordable as append-only events and the TII is provably
  unchanged — but there is no `authority.transferred` handling in projection, no
  authorization/signature check, no derived "current steward", no succession-kit
  generator. `spec/governance-candidate.md` + `spec/succession-policy.md`
  describe the procedure; the code only stores the events.

### L-8 — no graph / branch-merge / cycle engine (§15) — **LOW**

- "branch"/"merge" are just `event_type` strings + `series` records. Ancestry is
  whatever the events assert. There is no DAG, no visual tree, and **cycles are
  neither detected, forbidden, nor warned about** — the engine has no graph to
  find a cycle in. The spec lists `cyclic` only as a candidate `relation_kind`
  value.

### L-9 — timestamps unvalidated, timezones not normalised (§29) — **LOW**

- Ordering is by append `seq` (integrity-safe). But `recorded_at` accepts any
  string (past, `9999`, backward-jumping, absent→now) and TZ offsets are kept
  verbatim. Display consequence only: an event can show a misleading date.

### L-10 — minor security observations (§21) — **LOW / one HIGH-if-exposed**

- No execution or structural-corruption path was found across 22 code-shaped
  payloads on every surface (`spec/security-test-results.md`). `views.esc()`
  escaping is applied consistently; `javascript:` / `data:` values are shown as
  text, never as an `href`.
- Raw NUL / C0 control / bidi-override characters **pass through** into HTML and
  JSON as inert text (not stripped or flagged). LOW.
- No `Content-Security-Policy` header (server or static host). Defence-in-depth
  gap, not a live hole given the escaping.
- **`GET /admin/hash-file`** returns the SHA-256 of any server file path. Gated
  by `TII_ADMIN_TOKEN` — but **open when the token is unset** (single-admin
  mode). An unauthenticated arbitrary-file-read primitive **if the writable
  admin server is ever exposed without a token**. HIGH in that configuration;
  N/A for the current read-only static deployment.

### L-11 — `tii:` scheme / production identifier not live — **expected**

- `src/id.js` still issues the provisional 12-char Crockford token. The 26-char
  Base32 candidate (§22) and its collision-retry (§23) are **CANDIDATE ONLY**.
  Not a defect — a deliberate freeze state.

---

## Production-blocker classification (§44)

| Limitation | Class | Rationale |
|---|---|---|
| F-1 full-chain forgery undetectable by `verify()` alone | **BLOCKER** | integrity of the canonical record; fix = wire in the tested candidate checkpoint + key custody |
| F-3 no privacy mechanism (everything public) | **BLOCKER** *(if any non-public data)* | confidentiality; deferred model must be built before such data is accepted |
| F-2 single-writer ledger (multi-process corruption) | **BLOCKER** *(for a writable multi-instance registry)* / **NON-BLOCKING** for the current read-only mirror | data integrity under concurrent writes |
| Candidate checkpoint not wired into the live path (§24) | **BLOCKER** | same root as F-1 |
| Permanent resolver domain not chosen | **HIGH** | governance / citable spec URL / IANA reference; does not affect identifier function |
| IANA `tii` registration not filed | **HIGH** | scheme legitimacy; draft ready, `tii` still unregistered |
| Governance / change-controller identity unresolved | **HIGH** | blocks IANA + succession authorization |
| F-4 partial-write bricks `load()` | **HIGH** | availability of a writable deployment |
| L-7 stewardship transfer workflow (storage-only) | **MEDIUM** | succession is documented, not enforced |
| F-5 duplicate events on client retry | **MEDIUM** | data quality |
| F-6 O(events) / in-memory / full rebuilds | **MEDIUM** | fine at early scale; blocks a large registry |
| L-10 `/admin/hash-file` arbitrary read (no-token mode) | **MEDIUM** (HIGH if the writable admin server is public) | limit or auth-gate it before exposing writes |
| L-8 no cycle detection / graph engine | **LOW** | by design; spec does not require it |
| L-9 timestamp validation / TZ normalisation | **LOW** | display only |
| L-10 NUL/bidi pass-through, no CSP | **LOW** | defence-in-depth |
| 12-char test IDs not the production profile | **NON-BLOCKING** | deliberate freeze state |

---

## Scorecard (0–100, evidence-cited)

Each score is against **what runs today** (Layer A). Candidate/spec-only work
does not raise a live score.

| Dimension | Score | Evidence |
|---|---:|---|
| Identifier generation | **70** | §4 PASS: opaque, collision-checked, CSPRNG, always `test`. But the live token is the **provisional 12-char ~60-bit** Crockford form; the frozen 128-bit/26-char profile is CANDIDATE ONLY (§22). |
| Append-only integrity | **75** | §7/§25 PASS: no overwrite; `verify()` catches every localised tamper. Capped by §26 (full rewrite undetectable) and §27 F-4 (partial write bricks load). |
| Revision history | **95** | §7/§38/§39 PASS: supersede-not-overwrite, "no current interpretation" expressible, withdrawn categories stay in history, audit judgments themselves corrigible. |
| Open vocabulary | **100** | §6 PASS: unknown `event_type`/`module`/`act` survive storage→export→static→re-import→projection→render→verify; `labels.js` is display-only. |
| Optional-module behaviour | **100** | §5/§8/§9/§10/§11 PASS: minimal TII has `modules: {}`; no optional category is required or implied. |
| Identity non-essentialism | **100** | §5/§13/§16/§36/§37 PASS: no object/owner field; digest change ≠ identity change; equal hashes don't merge; 8 non-scholarly kinds; a "no stable object" TII works. |
| Address / domain handling | **95** | §11/§12 PASS: fully independent modules; multiple/none/competing addresses; none privileged; the identifier is never derived from an address. |
| Branch / merge | **55** | §15 PASS for "events + ancestry preserved", but there is **no graph engine, no tree view, no cycle handling**. |
| Localization | **95** | §18 PASS: 4 languages + correction + annotation; authored immutable; static build byte-stable; new language = no migration. Wired into the live projection/views. |
| External PID interoperability | **85** | §19 PASS: coexist, disappear, unknown types; TII not subordinate. −15: the system never resolves or validates an external id (correct by design, but "interoperability" is association-only). |
| Resolver behaviour | **85** | §4/§20: 200 / 404-unknown / 400-invalid / tombstone-withdrawn / no-current-state / multi-address / TEST-marked, all rendered; fragment stripped for lookup. −15: `verify()` not auto-run; withdrawn returns 404-ish only if the code path is hit. |
| Auditability | **60** | §25 PASS (localised tamper). §26 FAIL: `verify()` proves consistency, not authenticity. Auditability of *content* is excellent; auditability against *rewriting* needs the (candidate) checkpoint. |
| Cryptographic authenticity | **15** | §24: Ed25519 + JCS checkpoints exist and pass 13 checks — **CANDIDATE ONLY, wired into nothing**. The live service signs nothing. The 15 is for the SHA-256 chain (integrity, not authenticity). |
| Crash safety | **25** | §27 F-4: a partial write makes the whole ledger unloadable; no fsync/atomic-rename/journal/tail-recovery. F-5: duplicate events on retry. |
| Concurrency safety | **20** | §28: in-process single-writer is safe (100). Multi-process = corruption (0). No lock of any kind. Live prod is read-only so unaffected today. |
| Portability | **100** | §32 PASS: zero npm dependencies (`package.json` `dependencies: {}`); Node stdlib only; JSON/JSONL/CSV export; static rebuild; reconstruction needs only Node + `ledger.jsonl`. |
| Reconstruction | **95** | §32 PASS: identifiers, events, hashes, localizations, external ids, unknown vocab, evidence, public pages all survive an export→fresh-dir rebuild. −5: no live signed checkpoint means a reconstructor can't prove the copy wasn't pre-rewritten (§35). |
| Hosting independence | **100** | §33 PASS: no hostname in code/ledger/exports; `TII_RESOLVER_BASE_URL` is the single config point (default relative); prod `resolver_base` is `""`; `tiiarchive.vercel.app` is non-canonical. |
| Institutional succession | **35** | §35: identifiers + records survive a total operator loss. The **trust anchor** (live checkpoint), **domain/registrar custody**, **key custody**, and **IANA role** do not exist yet — succession is documented (`spec/succession-policy.md`, `spec/domain-failure-and-recovery.md`), not implemented. |
| Privacy | **0** | §40 NOT IMPLEMENTED: every field on every surface is public; `disclosure` hints ignored. |
| Security (input handling) | **80** | §21 PASS: no execution/structural-corruption path across 22 payloads; consistent escaping; hostile URLs shown as text. −20: NUL/bidi pass-through, no CSP, `/admin/hash-file` arbitrary read in no-token mode. |
| Scale | **55** | §31: fine to ~1k–5k TIIs (sub-second everything). At 10k TIIs registry render is 7 s and `rebuild-static` 11 s; everything O(events) and in RAM; no index/pagination/incremental build. |
| Public usability | **80** | The live site (English-first, resolver homepage, registry, per-TII page showing only non-empty sections, spec/audit/about, EN/JA) is clean and works; verified against production. −20: no search beyond client-side filter; registry unpaginated; resolver domain is a `.vercel.app` deployment URL. |
| **Production readiness** | **30** | Sum of the above: the **record model** is production-grade (revision, open vocab, optional modules, non-essentialism, portability, reconstruction all 95–100). The **infrastructure** is not: no live cryptographic authenticity (15), no privacy (0), crash safety (25), concurrency safety (20), succession not implemented (35), production identifier profile not live (70), domain/IANA/governance unresolved. |

---

## A — WHAT TII CAN DO TODAY (live)

1. Issue an opaque, collision-checked **test** identifier from `{recorder}` alone
   — no state, transition, ignition, address, domain, boundary, lineage, owner,
   or object field required or implied.
2. Append events with **any** `event_type` / `module` / `act` string; unknown
   vocabulary survives storage, export, static rebuild, re-import, projection,
   and rendering intact.
3. Revise without erasing: `supersedes` corrections, disputes, withdrawals; the
   projection can show "no record is currently interpreted as valid"; withdrawn
   classifications stay in history.
4. Treat state / transition / ignition / series / address / domain / relation as
   **optional, revisable** module records — including recording that a
   classification "was the wrong vocabulary".
5. Record multiple independent addresses (none privileged) and a separate domain
   scope; record content-verification digests without conflating a hash change
   with an identity change, or equal hashes with identity.
6. Decompose "ownership" into overlapping, conflicting, changing relations — no
   owner field anywhere.
7. Localize: append translations in any number of languages (with
   literal/interpretive kind and corrections); the authored event is never
   modified; the projection shows the viewer's language and falls back to the
   authored content; a new language needs no schema change.
8. Associate external identifiers (DOI/ARK/ISBN/URL/IPFS-CID/unknown), record
   their revocation, remain valid with none.
9. Detect **localised** ledger tampering with `verify()` (edits, deletion,
   reordering, duplication, `prev_hash`/`hash` edits).
10. Export the whole ledger as JSON / JSON Lines / CSV; rebuild the entire
    public site (EN + JA) as static files from `ledger.jsonl` alone;
    reconstruct the service in a fresh directory with only Node.js + the ledger
    — **zero npm dependencies**.
11. Serve a clean English-first public interface (resolver homepage, registry,
    per-identifier resolution page showing only non-empty sections, spec / audit
    / about, EN/JA) with no hostname baked in.
12. Handle code-shaped and hostile input as inert data — no execution or
    output-structure corruption path found.

## B — WHAT CANDIDATE CODE CAN DO (not live)

1. Generate a 128-bit-entropy, RFC 4648 Base32, 26-char `tii:` token; parse /
   canonicalize it strictly (no character repair); separate an RFC 3986
   `#fragment`; build a resolver URL; discard a collided candidate before it is
   recorded. (`src/candidate/identifier.js` — imported by nothing.)
2. Build an Ed25519-signed checkpoint over a ledger head + count + time, using
   RFC 8785 JCS as the signing input; verify it from a plain file; detect any
   tamper; survive property reordering / whitespace; reject duplicate JSON
   keys; support key rotation and `revoked_at`. (`src/candidate/checkpoint.js`,
   `src/candidate/jcs.js` — imported by nothing.)
3. **Detect the full-chain forgery of §26** — but only for a verifier who holds
   a checkpoint the live system does not produce.

## C — WHAT THE SPECIFICATION DESCRIBES BUT THE SOFTWARE CANNOT YET DO

1. Keep any event field non-public (privacy / disclosure / commitment /
   redaction — §40, spec §24).
2. Publish signed checkpoints / anchor the ledger to an external timestamp or
   witness so a rewrite is detectable on the live path (§26, §35).
3. Enforce or even surface a stewardship transfer (authorization, current
   steward, succession kit — §17, `governance-candidate.md`).
4. Operate independent mirrors with a defined authoritative-vs-mirror
   distinction (§22 of the domain prompt; concept only).
5. Resolve at a permanent domain, cite a permanent specification URL, or claim
   an IANA-registered scheme (`resolver-domain-decision.md`,
   `iana-provisional-registration.md` — not filed).
6. Issue a production identifier of any kind (deliberately disabled).
7. Safely accept concurrent writes from more than one process (§28).

## D — WHAT TII SHOULD NOT CLAIM TO DO (§42)

For every capability: TII can **record an assertion**; it does **not verify the
assertion is true.**

- Records a copyright / ownership claim — **does not** prove copyright ownership.
- Records a provenance / stewardship assertion — **does not** prove provenance.
- Records an ignition / transition / series judgement — **does not** prove the
  judgement is objectively correct; these are recorder judgements, revisable.
- Associates a DOI / ARK / external PID — **does not** check that the PID exists,
  resolves, or refers to the same thing.
- Records a content-verification digest — **does not** itself compute or check
  the digest of any external artifact; a matching hash is **not** proof of
  "same object".
- Stores a signed checkpoint (candidate) — proves *who attested to a head at a
  time*, **not** that the recorded events are true or complete.
- Runs `verify()` green — proves the chain is *internally consistent*, **not**
  that it was never rewritten (§26).
- Marks an identifier `test` / renders a resolution page — a valid identifier
  does **not** imply the associated content is valid, safe, true, authentic,
  scholarly, or approved.

---

## FINAL QUESTIONS — answered empirically

**What can TII actually do today?**
Record — append-only, un-rewritable-in-place, open-vocabulary, optionally-
modular, multilingual, identity-non-essentialist — the descriptions, judgements,
relations, addresses, translations, contestations, and revisions attached to a
reference point, and expose them as a derived projection + a static site, with
zero dependencies and full reconstruction from one file. (Layer A, mostly
PASS.)

**What can it not do today?**
Keep anything private (§40). Prove its canonical ledger was not rewritten,
without an external anchor (§26). Sign anything on the live path (§24). Accept
concurrent writes safely (§28). Survive a crash mid-write without manual repair
(§27). Enforce a stewardship transfer (§17). Issue a production identifier (by
design). Scale to a large public registry without O(events) rebuilds (§31).

**What survives if the UI disappears?**
Everything. `ledger.jsonl` + `bin/tii.js` regenerate the entire site; the API and
projection are independent of the UI. (§32, §33 — PASS.)

**What survives if the server disappears?**
Everything. The static export is the whole public surface; `rebuild-static` runs
from the ledger alone; the server is a convenience. (§32, §33 — PASS.)

**What survives if the domain disappears?**
The identifier (`tii:<token>` — no domain in it), the exported ledger, and local
reconstruction. Not: a citable spec URL or role email (need the unchosen
permanent domain). Signed-checkpoint / mirror recovery is CANDIDATE/CONCEPT
only. (§34 — PARTIAL.)

**What survives if P/A Institute disappears?**
The identifiers and the complete record, reconstructable by anyone from the
public repo + an exported ledger + Node.js. Not: proof the copy was not
pre-rewritten (no live checkpoint), domain/registrar/key custody, or the IANA
change-controller role — succession is documented, not implemented. (§35 —
PARTIAL.)

**What survives if the ledger is maliciously rewritten?**
If the rewrite is *localised* (an edit, a deletion, a reorder): `verify()`
catches it. If the attacker *recomputes the whole chain*: `verify()` accepts the
forgery. Only an independently-held signed checkpoint (CANDIDATE ONLY) or an
external timestamp would catch that — the live system publishes neither. (§26 —
FAIL.)

**What currently prevents TII from being a production-grade public identifier
infrastructure?**
Four things, in order:
1. **No live cryptographic anchor** — `verify()` alone can't detect a full
   rewrite (§26); the checkpoint code exists but is wired into nothing (§24).
2. **No privacy mechanism** — every field is public on every surface (§40).
3. **Single-writer ledger** — concurrent writes corrupt it (§28); a partial
   write bricks `load()` (§27).
4. **Unresolved production identity** — the 26-char token profile isn't live
   (§22), and the permanent domain / IANA registration / governance
   change-controller are undecided (`resolver-domain-decision.md`,
   `iana-provisional-registration.md`, `governance-candidate.md`).

The **record model** is production-grade. The **infrastructure around it** is
not yet.

---

## Production-Hardening Phase 1 — Before → Repair → After

Appended 2026-09-11. **Everything above this section is the original audit,
unchanged** — nothing above was edited, softened, or reworded to improve a
score. This section records what changed since, capability by capability,
for the items this phase's task explicitly scoped (P0-A/B/C, P1). See
[production-hardening-phase1.md](production-hardening-phase1.md) for the
full report and [capability-matrix.json](capability-matrix.json)'s
`phase1_production_hardening_update` block for the machine-readable version.

### §24 Candidate signed checkpoints
- **Before:** `CANDIDATE ONLY`. `src/candidate/checkpoint.js` +
  `src/candidate/jcs.js` existed and passed 13 isolated checks but were
  "imported by nothing in the running system." No live path signed anything.
- **Repair:** Both modules were promoted (`git mv`) to `src/checkpoint.js` /
  `src/jcs.js` and wired into a new live operational layer,
  `src/checkpoint-store.js`, itself wired into `bin/tii.js checkpoint
  create/verify/list/keygen`, `GET /status`, `GET /checkpoint/verify`,
  `GET /checkpoint/list`, `GET /audit`, and an auto-checkpoint-on-write hook
  in `src/server.js`. See [checkpoint-operation.md](checkpoint-operation.md).
- **After:** `PASS (A — live core)`, conditional on an operator configuring
  a signing key. With no key configured, checkpoint *creation* fails closed
  (`NoSigningKeyError`) — reads and chain-integrity verification are
  unaffected. `src/candidate/README.md` now documents only
  `identifier.js` as remaining unwired candidate code.

### §26 Full-chain regeneration attack
- **Before:** `FAIL`. "verify() cannot distinguish forged from legit... a
  candidate signed checkpoint DOES detect it (true)" — but that candidate
  code was not live, so in practice nothing detected it.
- **Repair:** Checkpoints are now live (§24, above). A **permanent
  regression test**, `test/checkpoint-store.test.js` test C, forges a full
  chain and asserts both halves of the claim: `Ledger.verify().ok === true`
  (claim A still can't see it — this has NOT changed and is not claimed to
  have changed) AND `verifyCheckpoint(...).matches_current_head === false`
  against a legitimately-signed checkpoint of the real head (claim B catches
  it). This test is required to remain in the suite permanently.
- **After:** Still `FAIL` for claim A alone — this is correct and expected;
  claim A was never meant to catch this. Now `PASS (A — live core)` for the
  *combined* claim A+B posture, **conditional on an operator actually
  configuring a signing key and retaining a checkpoint from before any
  forgery** (a checkpoint published only after an attacker's rewrite
  would attest to the forged head, not the real one — see
  [checkpoint-operation.md](checkpoint-operation.md) §What this does not
  claim). Without a configured key, the system is exactly as exposed to
  this attack as before.

### §21 (in part) — `GET/POST /admin/hash-file` arbitrary-file-read
- **Before:** Listed as a limitation under §21 PASS and again in
  `spec/security-test-results.md` item 4: "an unauthenticated
  arbitrary-file-read primitive if the writable server is exposed without a
  token... HIGH if the writable admin server is ever public." Root cause:
  `authorized()` returned `true` when no token was configured.
- **Repair:** `authorized()` now returns `false` unconditionally when
  `TII_ADMIN_TOKEN` is unset — NO ADMIN TOKEN = ADMIN DISABLED, no
  anonymous fallback in either direction. Separately, even *with* a token
  configured, `hash-file` no longer accepts an arbitrary absolute server
  path: it requires `TII_ADMIN_HASH_DIR` to be explicitly configured and
  rejects any path (absolute, or relative-with-traversal) that resolves
  outside it. See
  [production-hardening-phase1.md](production-hardening-phase1.md) §Admin
  fail-closed.
- **After:** The HIGH-severity finding is closed. Verified by
  `test/admin-security.test.js` (6 tests): no-token → disabled, wrong-token
  → denied, correct-token → allowed, token never in any response, token
  never in the ledger, absolute-path and path-traversal rejected, and a
  static deployment exposes zero admin mutation capability.

### §27 Crash consistency
- **Before:** `PARTIAL`. "A partial/interrupted final write makes the
  ENTIRE ledger fail to load... until the line is manually removed. No
  fsync, no atomic rename, no journaling, no tail recovery... no
  idempotency key, dedup, or request-id."
- **Repair:** Write-ahead journal + double fsync (journal, then ledger) per
  append; explicit, non-silent recovery detection and commands (`tii
  recover inspect/truncate-tail/commit-journal/discard-journal`); an
  idempotency-key mechanism for both `issueTII` and `append`. See
  [crash-recovery.md](crash-recovery.md).
- **After:** Still `PARTIAL` — this phase does not claim crash consistency
  is now unconditionally solved. What changed: a truncated/malformed tail
  no longer makes the whole ledger unparseable-and-stuck — it's detected,
  the valid prefix still loads read-only, and an explicit, backed-up,
  operator-invoked repair path exists. Retried writes with the same
  idempotency key no longer silently double-record. **New, honestly
  disclosed cost:** append throughput dropped from ~7,800–9,800/s to ~98/s
  (~10.2 ms/append) due to the two fsync calls — see §Cost in
  [crash-recovery.md](crash-recovery.md) and the `phase1_production_hardening_update`
  entry in `capability-matrix.json`. This is a genuine regression in raw
  throughput, traded deliberately for crash safety, not an oversight.

### §28 Concurrency — multiple OS processes writing one ledger.jsonl
- **Before:** `FAIL`. "The JSONL ledger is SINGLE-WRITER ONLY... [concurrent
  processes] produce duplicate seq numbers, broken prev_hash links, corrupt
  lines, lost updates, verify() failure."
- **Repair:** TII 1.0 now formally adopts and *implements* a
  single-authoritative-writer model: cross-process advisory locking
  (`src/writer-lock.js`, `O_EXCL`-based, with stale-lock reclaim and bounded
  retry) plus an in-lock in-memory resync fix for a subtler bug found during
  this phase's own testing (a lock alone does not prevent a writer from
  computing conflicting event fields from a stale in-memory snapshot — see
  [single-writer-model.md](single-writer-model.md) §Mechanism: in-process
  resync). This is explicitly **not** multi-writer distributed issuance —
  concurrent independent writers are refused, not merged.
- **After:** Re-run of the same shape of test (`test/writer-lock.test.js`,
  "§20/§26 CONCURRENCY REGRESSION" — 12 processes × 10 appends, required to
  remain permanently in the suite) now shows `verify().ok === true`, **zero**
  duplicate `seq`, **zero** chain breaks, and every one of the 120 attempts
  accounted for as either committed or cleanly refused
  (`WriterLockedError`). Status changes from `FAIL` to `PASS (A — live core)`
  **for the single-writer model specifically** — multi-writer distributed
  concurrency remains unimplemented and out of scope, and this is stated
  explicitly rather than implied to be solved.

### §40 Privacy boundary
- **Before:** `NOT IMPLEMENTED`. "Anything written to an event is public...
  This is an OPEN PRODUCTION ISSUE by design (the model is specified but not
  built)."
- **Repair:** No privacy mechanism was built this phase (explicitly out of
  scope — "Do NOT implement a private-data subsystem in this phase"). What
  changed is that TII 1.0 now makes an explicit, narrow **scope claim**
  instead of an implicit gap: "public-registry-only," documented
  normatively in [public-only-1.0.md](public-only-1.0.md), with a visible
  PUBLIC RECORD warning on every admin/write UI surface.
- **After:** Still `NOT IMPLEMENTED` — this finding is not closed and is not
  claimed to be closed. What changed is honesty about scope: TII 1.0 no
  longer implicitly invites the assumption that private/restricted material
  might be safe to record "eventually" without saying so; it states plainly
  that this version is public-only and lists what a future
  restricted-disclosure mechanism would require without building any of it.

### Unchanged by this phase (stated explicitly, not silently implied)
§22 candidate 26-char identifier remains `CANDIDATE ONLY`, still unwired.
§17 stewardship transfer workflow remains `PARTIAL` (spec-only procedure).
§30/§31 scale/large-payload characteristics are unchanged — this phase did
not touch the in-memory, full-scan architecture; the append-path fsync cost
above is additive to, not a replacement for, those limits. §34/§35 domain
and full-operator-loss findings are unchanged — no domain was purchased and
no governance/succession mechanism was implemented this phase.

---

## Artifacts

| File | Contents |
|---|---|
| `spec/capability-matrix.json` | 34-row machine-readable matrix; every PASS backed by an executed test |
| `spec/performance-results.json` | §30/§31 large-payload + scale measurements (100 / 1,000 / 10,000 TIIs) |
| `spec/security-test-results.md` | §21 — 22 payloads × every surface; verdict + per-surface table |
| `spec/audit/capability-audit.js` | main harness (§4–§19, §36–§42) + folds in the sibling results |
| `spec/audit/adversarial-audit.js` | §21, §25 (tamper), §26 (forgery), §27 (crash), §29 (clock) |
| `spec/audit/concurrency-audit.js` | §28 — spawns 2 / 10 / 100 writer processes |
| `spec/audit/performance-audit.js` | §30 / §31 generators (data not committed) |
| `spec/audit/reconstruction-audit.js` | §32 / §33 / §34 / §35 |
| `spec/audit/demonstration.js` | §41 — one TII through 16 capabilities → timeline |
| `spec/audit/*-results.json`, `demonstration-timeline.json` | raw run outputs |
| `test/capability-regression.test.js` | the deterministic subset, runnable under `node --test` |

Re-run everything: `for f in capability adversarial concurrency performance
reconstruction demonstration; do node spec/audit/$f-audit.js 2>/dev/null ||
node spec/audit/$f.js; done` (the perf + concurrency runs take ~1–2 min).

---

## Adversarial Verification of Production-Hardening Phase 1

Appended 2026-09-11. **Everything above this section, including the
"Production-Hardening Phase 1 — Before → Repair → After" section, is
unchanged from its prior form** — nothing above was edited, softened, or
reworded. This section records the results of a dedicated adversarial pass
against commit `4ce2d80` that specifically tried to break the Phase 1
hardening claims (not merely re-confirm them). Full detail, reproduction
steps, and root-cause analysis:
[phase1-adversarial-verification.md](phase1-adversarial-verification.md);
machine-readable form: [phase1-failure-matrix.json](phase1-failure-matrix.json).

**Two real, exploitable defects were found in Phase 1's own new code and
fixed, each with a permanent regression test:**

1. **D1 (HIGH):** `/admin/hash-file`'s "restricted to a configured safe
   directory" claim — stated as closed in the Phase-1 update above — was
   only half true. The directory confinement was purely lexical
   (`path.resolve` + string prefix); a symlink planted *inside* the safe
   directory pointing *outside* it completely bypassed it (direct symlink,
   nested symlink, and symlinked directory all escaped). Fixed via
   `fs.realpathSync()`-based confinement.
2. **D2 (MEDIUM-HIGH):** `GET /checkpoint/verify?file=`, a new,
   deliberately unauthenticated route this same phase introduced, forwarded
   its query parameter uninspected into a trusted internal API, making it
   an unauthenticated file-existence oracle / arbitrary-path reader over
   the server filesystem. Fixed by restricting the parameter to a bare
   filename at the HTTP boundary.

**Several further limitations were found, reproduced, and documented
without being fixed**, because fixing them would require a design/policy
decision this phase's own instructions forbid making unilaterally (see the
adversarial-verification doc's Defect List L1–L9 for the full reasoning on
each) — most notably: checkpoint "latest" selection trusts filename sort
over validity (L1); a checkpoint backdated with a compromised
pre-revocation key is cryptographically indistinguishable from a genuine
historical one, confirmed empirically (L2); TII's checkpoints are not yet
an "external anchor" in any deployment where the checkpoint directory
isn't actually held independently of the ledger's host (L3); and TII adds
no directory-level fsync, so its crash-safety guarantee is scoped to
process crashes, not power-loss durability of directory metadata on every
filesystem (L9, relevant to §27 above).

**Everything else tested — the mandatory §8-equivalent restart+idempotency
sequence, the full 9-point journal crash matrix, 2/10/100-writer
concurrency, the 5-type partial-tail-recovery diagnostics, checkpoint/
ledger divergence states, the public-only leakage confirmation, static
mirror hygiene, and the live deployment's read-only posture — held up under
adversarial testing.** Phase 1 is not claimed stronger than it is: this
pass narrows several claims further (see L1–L3 above) rather than
confirming them unconditionally, and reports the live deployment's exact
commit provenance as NOT VERIFIED (not observable from page content alone)
rather than assumed. Score changes are NOT automatic — see
`spec/capability-matrix.json`'s `phase1_adversarial_verification_update`
block for the itemized before/after.

---

## Production Launch Gate (appended 2026-09-11)

**Everything above is unchanged.** The Production Launch Gate phase
promoted §22/§23's "CANDIDATE ONLY" 26-char production identifier from
unwired to **gated-capable-but-closed**: it is now reachable through
`src/production-issuance.js` and `bin/tii.js issue --production`, but every
call is refused by `src/production-gate.js`'s 9-condition gate, which this
repository's committed configuration never satisfies (`available: false`
in this repo, always — verified by a permanent test asserting exactly
that against the real `data/ledger.jsonl` and real `process.env`). §26's
"live system publishes no signed checkpoints" finding is also updated: a
PRODUCTION checkpoint policy (checkpoint after every production mutation,
fail-visible and mutation-blocking on signing failure) is now frozen and
implemented — though, as with the identifier profile, it is exercised only
by the (closed) production path and by tests, not by any active issuance.

Full detail, the complete G1–G14 launch-readiness table (five gates not
yet PASS: key custody, resolver, governance, IANA, release-artifact
acceptance), and the overall **NOT READY** determination:
[production-launch-gate.md](production-launch-gate.md). Machine-readable:
[launch-status.json](launch-status.json). No production identifier was
issued; no test identifier was promoted; the canonical ledger is
byte-for-byte unchanged by this phase.
