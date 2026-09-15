# First Production TII — Content Plan

> **Not executed. Prepared 2026-09-15, per the pre-G9 final launch
> audit.** This specifies WHAT will be issued once
> `spec/first-production-issuance-procedure.md` step 13 actually runs.
> It does not authorize running it.

## What record will be issued

**A newly generated production identifier — never the historical test
identifier.** `tii:h4r3jsn4p25d` (the only identifier in the canonical
ledger today) remains `identifier_status: "test"` permanently; it is
never promoted, never reused, never referenced as if it were a
production issuance. `issueProductionTII()` (`src/production-issuance.js`)
always calls the frozen 128-bit generator fresh — there is no code path
by which an existing identifier, test or otherwise, could become the
"first" production one. This has already been proven, not merely
asserted: `test/production-gate.test.js` §0 ("no test identifier can be
'promoted': production issuance always calls the generator fresh, never
accepts an existing tii string") and the pre-G9 rehearsal both confirm
this directly.

The first production TII will therefore be a single `tii.issued` event,
minted at the moment step 13 of the issuance procedure actually runs,
with a token neither chosen nor known in advance.

## Minimum metadata (thin core only — no ontology dump)

Per `SPEC.md`'s own core (§5) and the "no ontology dump, no
self-certifying claims" discipline already established in
`spec/first-production-issuance-procedure.md`'s "What this procedure
deliberately does not include" section, the first production event
carries only what the thin core actually requires:

| Field | Value |
|---|---|
| `event_type` | `tii.issued` (fixed by `issueProductionTII()`) |
| `recorder` | The accountable operator performing the procedure — `{ id: "Naoto Fujie", kind: "person" }` (or the exact identity used to authenticate `TII_ADMIN_TOKEN` at step 12; must be a real, accountable identity, not a placeholder) |
| `content.identifier_status` | `"production"` (set automatically by `issueProductionTII()`) |
| `content.note` (optional, operator's choice) | A short, factual statement of what this identifier is a reference point for — e.g. "First production Transition-Ignition Identifier, issued under TII 1.0." Nothing more elaborate is required or recommended. |

**Explicitly not included**, because the thin core does not require them
and adding them would be ceremony, not necessity (per the launch gate's
own content-discipline principle):

- No `state`, `transition`, `ignition`, `address`, `domain`, `boundary`,
  or `lineage` module entries.
- No claim that this identifier is "the first TII," "historic," or
  otherwise self-certifying in language — the ledger's own event order
  already records that fact; the content field does not need to assert it.
- No external identifiers (DOI/ARK/ORCID/etc.) unless a real one already
  exists for whatever this identifier references.
- No philosophical or theoretical-architecture claims (Ziran System or
  otherwise) — `SPEC.md` §1 already states TII operates below such
  architectures; the first record does not need to re-assert this.

## Production checkpoint sequence

Automatic within `issueProductionTII()` (checkpoint-after-every-
production-mutation policy, `spec/production-launch-gate.md` §16/§17):
append the event first (durably fsynced), then immediately attempt
`checkpointStore.createCheckpoint()`. Two outcomes:

- **`CREATED`**: proceed to public verification below.
- **`FAILED`**: the event is already committed and is NOT rolled back
  (append-only is never violated to "undo" a checkpoint failure); further
  production mutations are blocked (`checkpoint_current` gate condition)
  until an operator restores checkpoint currency via `tii checkpoint
  create`, per `spec/first-production-issuance-procedure.md` step 17.

## Public verification sequence

1. `tii checkpoint verify` (or `checkpointStore.verifyCheckpoint()`)
   reports `status: VERIFIED` and `matches_current_head: true` against
   the freshly-appended head.
2. The checkpoint's embedded public key and `key_id` (`1486de6152baec7f`)
   are cross-checked against the independently-published value in
   `spec/production-key-custody.md` §8.7 — they must match; if they do
   not, treat this as a launch incident, not a formatting quirk.
3. `tii rebuild-static` (or the live server) regenerates the public
   projection; confirm the new identifier's page and its `.json` export
   both exist and report `identifier_status: "production"` (the pre-G9
   rehearsal confirmed this is correctly exposed in `catalog.json` and
   the per-identifier JSON, though not currently rendered as visible text
   on the human-facing HTML page — see the rehearsal finding in
   `spec/production-launch-gate.md`'s "Pre-G9 final launch audit" note;
   this is a cosmetic gap, not a blocker).

## Resolver verification

Fetch `https://transition-ignition-id.org/tii/<slug>` (where `<slug>` is
the new token with `:` replaced by `_`, matching the existing static-site
convention) over the live, deployed resolver — not a local build — and
confirm it returns HTTP 200 with the expected record, exactly as the
pre-G9 audit's Section 9 route check did for the existing test
identifier. Also fetch `/catalog.json` and confirm the new identifier
appears in `identifiers[]` with `identifier_status: "production"`.

## Rollback / failure behavior

There is no rollback of a committed append — append-only is absolute.
"Failure" after the event is committed means a subsequent step (checkpoint
creation, static rebuild, resolver deployment) did not complete; the
identifier remains validly issued and its history remains intact
regardless. The only two contexts where nothing is committed at all are:
(a) the gate is closed (`ProductionGateClosedError`, thrown before any
generation or append attempt), and (b) a collision is detected inside the
writer lock (the colliding candidate is discarded before ever being
recorded, and a fresh candidate is drawn — already proven in the existing
test suite, `test/production-gate.test.js` §10).

## Audit record

Per `spec/first-production-issuance-procedure.md` step 22: record, in a
durable, non-secret location, the exact identifier issued, the exact
event (full JSON), the checkpoint file (or its hash + location), the
operator identity who performed the procedure, the timestamp, the exact
git commit hash of the code that performed it, and the outcome of every
step of that procedure. This becomes the first entry in a permanent
"production issuance log" — this plan does not create that log file now
(nothing has been issued yet); step 22 itself specifies exactly what it
must contain when the time comes.

## What this plan deliberately leaves to the operator, not automated

The exact wording of `content.note` (if any) and the exact `recorder.id`
string are a human choice at the moment of issuance — this plan
constrains their *shape* (thin, factual, no ontology, no self-certifying
claims) but does not pre-write them, since pre-writing them now would be
choosing content weeks or months before the actual accountable operator
is known to be ready to issue.
