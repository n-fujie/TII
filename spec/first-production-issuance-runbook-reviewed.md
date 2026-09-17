# First Production TII Issuance — Reviewed Runbook

> **Not executed. Nothing below has been run.** This is the exact,
> reviewed command sequence and the exact proposed issued content,
> prepared for explicit human approval per this task's instruction to
> "produce the reviewed runbook and proposed first-production object
> only." Bridges `spec/post-iana-enablement-runbook.md` (the general
> 8-step post-IANA bridge) and `spec/first-production-issuance-procedure.md`
> (the original 22-step generic procedure) into one concrete, ready-to-run
> instance for this specific event, using the exact mechanism already
> rehearsed and verified in
> `spec/production-issuance-authorization-record.md`'s "Production-gate
> activation rehearsal."

## Pre-issuance baseline (captured now, read-only, before anything runs)

```
Canonical ledger:      data/ledger.jsonl
SHA-256:               6882290be03e67ffd6abddafbfcccdf5a0a44b1cf4770d6f4763ce786c0d85fd
Head hash:             eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95
Event count:           10
Identifier count:      1
Identifiers:           tii:h4r3jsn4p25d  (identifier_status: test)
Ledger chain:          VALID (verify().ok === true)
```

Current checkpoint, independently verified against its embedded public
key (no passphrase involved in verification):

```
File:                  checkpoint-0000000010-2026-09-17T031239532Z-d1515f.json
Status:                VERIFIED
Key ID:                1486de6152baec7f
matches_current_head:  true
```

This checkpoint is already current for the present head. Per the
production-gate mechanism, `checkpoint_current` will re-evaluate `true`
the moment `signing_ready` is also true in the same process — no new
checkpoint needs to be created before issuance for this precondition;
one will also be created automatically immediately after the issuance
itself (checkpoint-after-every-production-mutation policy).

## The idempotency key for this issuance

```
tii-first-production-issuance-2026-09-17
```

Unique, dated, purpose-labeled — will never collide with any test key
used in prior rehearsals (`REHEARSAL-K1`, `PARITY-K`, `K`, `SHARED-KEY`,
etc., all in disposable ledgers, never this one).

## The proposed content — exact object to be appended

Per `spec/first-production-tii-plan.md`'s already-agreed minimum
(thin-core only, no ontology, no self-certifying claims), reused
unchanged here:

```json
{
  "event_type": "tii.issued",
  "tii": "<128-bit CSPRNG token, generated fresh at the moment of issuance — cannot be known in advance, and no candidate should be pre-selected or reused>",
  "recorder": { "id": "Naoto Fujie", "kind": "unspecified" },
  "content": {
    "tracking_started_note": "First production Transition-Ignition Identifier, issued under TII 1.0.",
    "identifier_status": "production"
  },
  "idempotency_key": "tii-first-production-issuance-2026-09-17"
}
```

Notes on this exact shape:
- `recorder.kind: "unspecified"` — the CLI's `--recorder` flag only
  accepts a plain string (`bin/tii.js`: `recorder: flag('--recorder', 'cli')`,
  normalized by `src/ledger.js` `normalizeRecorder()`), so it cannot
  carry `kind: "person"` as the plan document aspirationally described.
  This is existing, unmodified CLI behavior — not a change made for this
  event — and is an accurate, honest recorder kind either way.
- `content.identifier_status` is set automatically by
  `issueProductionTII()`, not passed explicitly.
- `tii`, `event_id`, `seq`, `hash`, `prev_hash`, timestamps are all
  determined only at the moment of the real append — none of them can be
  shown in advance without either fabricating a value or actually
  running the mutation, which this runbook does not do.
- No `state`, `transition`, `ignition`, `address`, `domain`, `boundary`,
  `lineage`, or external-identifier field — none required, none added.

## The exact command sequence (to run in your own terminal only)

This is the same mechanism already successfully rehearsed
(`spec/production-issuance-authorization-record.md`), extended with the
one additional real command — the issuance itself — which was not run
during the rehearsal.

```bash
cd /Users/user/Desktop/BIM/tii
umask 077
read -s -p "Production key passphrase: " TII_PASS
echo
PASS_FILE=$(mktemp)
printf '%s' "$TII_PASS" > "$PASS_FILE"
unset TII_PASS

export TII_PRODUCTION_ISSUANCE_ENABLED=true
export TII_GOVERNANCE_APPROVED=true
export TII_RESOLVER_APPROVED=true
export TII_IANA_GATE_SATISFIED=true
export TII_CHECKPOINT_PRIVATE_KEY_FILE="$HOME/.tii-production/signing-key.final.encrypted.pem"
export TII_CHECKPOINT_KEY_PASSPHRASE_FILE="$PASS_FILE"

# 1. Confirm the gate is open, in THIS shell, immediately before issuing.
node bin/tii.js production-status
# Expected: "available": true, "blocked_by": [], all nine conditions true.
# STOP here if this does not read available: true — do not proceed to step 2.

# 2. THE ISSUANCE ITSELF. Exactly one real production identifier.
node bin/tii.js issue --production \
  --recorder "Naoto Fujie" \
  --note "First production Transition-Ignition Identifier, issued under TII 1.0." \
  --idempotency-key "tii-first-production-issuance-2026-09-17"

# 3. Clean up the passphrase file immediately.
rm -f "$PASS_FILE"
```

**Do not add `--dry-run`** — that would only preview a candidate and
append nothing; this runbook already shows the exact command and content
without needing a live dry-run pass through the gate.

**This agent will not run this command.** Per this task's explicit
instruction, execution stops here, before step 2. Paste back the exact
JSON output of `production-status` and of the `issue --production`
command (both non-secret — no passphrase or private key appears in
either) once you choose to run this yourself.

## Post-issuance verification plan (to run after you report success — not run yet)

All twelve required checks, mapped to the exact mechanism each will use:

| # | Check | How |
|---|---|---|
| 1 | Exactly one new `tii.issued` event | `Ledger.load().events.filter(e => e.event_type === 'tii.issued').length` before vs. after: must increase by exactly 1 |
| 2 | Exactly one new production TII | The new event's `content.identifier_status === "production"`; `ledger.listTIIs()` grows by exactly one entry, distinct from `tii:h4r3jsn4p25d` |
| 3 | Ledger verification | `node bin/tii.js verify` → `VALID`; independently recompute chain via `Ledger.verify().ok` |
| 4 | New ledger head | Compare `head_hash` before (`eb27a2b7...`) vs. after — must differ; recompute SHA-256 of `data/ledger.jsonl` and confirm it changed in exactly the expected way (new line appended, all prior lines byte-identical) |
| 5 | New signed checkpoint for that head | `node bin/tii.js checkpoint verify` → `VERIFIED`, `matches_current_head: true`, `key_id: 1486de6152baec7f`, `ledger_head_hash` equal to the new head |
| 6 | Catalog and per-identifier projection rebuild | `node bin/tii.js rebuild-static <dir>` (the now-atomic build) → confirm `catalog.json` lists the new identifier and a per-identifier `.json`/`.html` pair exists for it, consistent with `spec/issuance-path-audit-2026-09-19.md`'s registry↔resolver consistency check |
| 7 | CLI lookup | `node bin/tii.js show <new-tii>` and `events <new-tii>` — including a fragment-bearing form, per `spec/duplicated-implementations-audit-2026-09-17.md` |
| 8 | Dynamic resolver | Boot `src/server.js` against the real ledger, `GET /tii/<slug>` → 200, `GET /resolve?tii=<new-tii>` and `#fragment` form → same target |
| 9 | Static resolver | Execute the actual shipped client-side script from the freshly built `index.html` (the same `vm`-based technique used throughout this project) against the new identifier, with and without a fragment |
| 10 | Deployed resolver | After a real deploy (`git push` → Vercel auto-build, the same path used for every prior spec/doc change in this project), fetch `https://transition-ignition-id.org/tii/<slug>` and `/catalog.json` live and confirm the new identifier appears |
| 11 | Same-key/same-content idempotent retry | Re-run the exact `issue --production` command from this runbook again, same idempotency key, same recorder/note — must return the identical original event, `idempotent_replay: true`, and the ledger event count must not increase |
| 12 | Fresh-shell gate-closed confirmation | `node bin/tii.js production-status` in a brand-new shell with no `TII_*` variables set → `available: false` again, same conditions blocking as before this event — proving the ephemeral enabling environment left nothing persistent, exactly as the activation rehearsal already demonstrated |

## Scope discipline

This runbook does not modify identifier syntax, token format, canonical
form, ledger semantics, issuance logic, resolver behavior, or gate
logic — it only sequences already-existing, already-verified mechanisms
in the order this specific event requires. Nothing in this document has
been executed.

**Stopping here — waiting for explicit approval before running the
issuance command.**
