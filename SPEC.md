# TII — Transition-Ignition Identifier

**Public Specification**
遷移発火識別子

Specification version: `0.1.0` · Status: **Experimental Specification**

This document is normative for the reference implementation in this repository.
While the specification is experimental, every identifier issued by this
implementation is a **test identifier** (see §9).

---

## 1. Purpose

TII is a reference and audit infrastructure for recording **how distinctions,
relations, functions, classifications, and other descriptions become operative
under specified conditions**, and how those recorded conditions, relations,
addresses, interpretations, and transitions **change over time**.

Issuing a TII means only one thing: **tracking has started from a stated
reference point.** It does not assert that a fixed object exists, that the
reference point is permanent, or that any particular description of it is final.

TII operates **below** research and theoretical architectures (such as the Ziran
System). It does not replace them and does not stand above them.

## 2. What TII does not assume

TII does **not** assume that:

- identity is intrinsic;
- state is universally applicable;
- transition is a universal ontological primitive;
- ignition is a universal ontological primitive;
- address is fixed;
- domain is fixed;
- boundary is fixed;
- ownership is intrinsic;
- lineage is inherently given.

Each of these is a **revisable operational description**. It is adopted only when
a recorder finds it useful, and it can later be qualified, contested, replaced,
redefined, or withdrawn — without erasing the earlier record.

> **Transition and ignition are revisable operational descriptions, not universal ontological primitives.** The name "Transition-Ignition Identifier" reflects the descriptions TII most often carries; it is not a claim that every TII contains a transition or an ignition.

## 3. What TII does not guarantee

A TII, by itself, does **not** guarantee:

- essential identity;
- ownership;
- authenticity;
- scholarly validity;
- truth;
- permanence;
- persistence of hosting;
- correctness of classification.

What TII does: it **records and exposes traceable assertions, relations,
changes, evidence, contestation, and revision** — with an append-only history
that is never rewritten.

## 4. Three kinds of maturity

These are distinct and must not be conflated:

| Concept | Meaning | Current value |
|---|---|---|
| Specification maturity | How settled the TII specification itself is | Experimental (`0.1.x`) |
| Deployment maturity | How settled a particular running instance is | Early; public instance is a read-only static mirror |
| Identifier status | Whether a specific identifier is production or test | All currently issued identifiers are **test identifiers** |

## 5. TII Core

The core is deliberately minimal. An event carries only:

1. an opaque TII;
2. a record event;
3. references between events;
4. the time the event occurred or was registered;
5. the recording party or mechanism;
6. the recorded content;
7. a reference to evidence or grounds;
8. a structure that *can* carry a content-verification value;
9. a structure that *can* carry external references;
10. an audit link to the immediately preceding record.

State, transition, ignition, address, domain, ownership, lineage, series, scale,
and boundary are **not** core fields.

### 5.1 Event shape

```jsonc
{
  "event_id": "evt_…",              // opaque
  "tii": "tii:…",                   // target identifier
  "seq": 0,                         // position in the ledger
  "recorded_at": "2026-01-01T00:00:00.000Z",       // asserted time
  "ledger_written_at": "2026-01-01T00:00:00.000Z", // time written to the ledger
  "recorder": { "id": "…", "kind": "person|mechanism|…" },
  "event_type": "free string",
  "content": { },                  // recorded content (any structure)
  "basis": [ ],                    // evidence / grounds references
  "external_refs": [ ],            // optional
  "content_verification": { "algo": "sha256", "value": "…" }, // optional
  "supersedes": "evt_…",           // optional; the superseded event is kept
  "prev_event_for_target": "evt_…",
  "prev_hash": "<hex>",
  "hash": "<hex>"
}
```

`event_type` is an open vocabulary. Unknown event types, unknown module names,
and unknown act values are all stored verbatim and displayed as-is.

### 5.2 Append-only history

Existing records are never overwritten. A correction is a **new** event that
references the event it supersedes; the current reading is then recomputed. The
superseded event remains in the ledger and in the history.

### 5.3 Hash chain

```
hash = SHA-256( prev_hash + canonicalJSON(event without "hash") )
canonicalJSON = recursively key-sorted, deterministic JSON
genesis prev_hash = "0" × 64
```

Verification recomputes the entire chain and detects rewritten content, deleted
lines, and reordering. No blockchain, token, or cryptoasset is involved. Digital
signatures and multi-signature schemes may be added later as event content.

## 6. Optional descriptive modules

A module is a **convention over `content`**, not a privileged structure:

```jsonc
{ "module": "…", "ref": "…",
  "act": "introduce | apply | hold | stop | replace | redefine | dispute | withdraw | …",
  "description": "…", "…": "module-specific fields" }
```

Module names and `act` values are open sets. A module with no records is simply
absent — the interface never shows an empty module.

| module | notes |
|---|---|
| `state` | Discrete states are not assumed. Two states may later be re-described as one continuous process. |
| `transition` | `A → B` is not fixed as an ontological fact. "Classifying this as a transition was inappropriate" is itself a recordable correction. |
| `ignition` | A described distinction / function / rule / role becoming operative under stated conditions. Not physical combustion. Not reduced to a boolean. |
| `address` | Current public / storage / repository / network / physical / logical location. Multiple simultaneous addresses are allowed; none is automatically privileged as authoritative. |
| `domain` | The operative or analytical scope within which a record, relation, distinction, or classification is being interpreted. **Distinct from address.** |
| `boundary` | Changing a boundary may change identity or relation judgements. That is normal; the change history is kept. |
| `relation` | administers / stores / accesses / modifies / copies / distributes / maintains / stops / deletes / transfers / signs / holds-copyright / funds / publishes / verifies / … — an open set. There is no single required `owner` field. |
| `series` / lineage | A **judgement** placed between records, not a recorded object. Same-series / different-series / unknown / dispute / split / merge / withdraw. Prior judgements are never deleted. |
| `external_identifier` | DOI / ARK / ISBN / ORCID / URL / IPFS CID / … Associated, never treated as a competitor. A TII is valid with none. |
| `interpretation` | A revision of what this TII is understood to be tracking. The identifier string never changes. |
| `localization` | An appended translation or localized rendering of a source event's content for a target language. Presentation and annotation — not evidence. It carries `source_event`, `source_language`, `target_language`, `kind` (`literal` / `interpretive`), and `translated_content`. The translation's `recorded_at` is the time of translation, which is a different fact from the source event's authored time. A later `localization` event for the same source and language supersedes an earlier one; the earlier one is retained. The authored content is never modified. |

The authored language of an event is part of the record: new events set
`content.language`. Localization is additive — a record authored in Japanese,
English, or any other language keeps its source form, and any number of
target-language renderings can be appended later without a schema change. There
are no `description_en` / `description_ja` core fields.

## 7. Separation of evidence, judgement, and display

1. **Evidence** — `basis`, `content_verification`, `external_refs`.
2. **Judgement** — what a `recorder` asserted in `content`.
3. **Display** — the "current reading" recomputed from the event stream.

The system does not derive a single correct ontological conclusion from
evidence. A sequence such as *evidence recorded → recorder X judges "ignition" →
recorder Y contests → the judgement is later withdrawn* is retained in full.

### 7.1 No display-driven mutation

**No public rendering, localization, projection, export formatting, or
documentation change may mutate previously recorded canonical events.**

This is normative. Concretely:

- Changing the interface language, display terminology, labels, translations,
  documentation wording, or the preferred public language must never rewrite an
  existing canonical event.
- The projection layer chooses which representation to display — for an English
  page, an English localization if one exists, otherwise the authored content;
  likewise for Japanese or any other language — but the projection is derived
  output, not historical truth, and it never writes to the ledger.
- `rebuild-static` is a pure derivation from the ledger plus
  documentation/localization resources. Running it does not alter ledger
  contents, event IDs, timestamps, hashes, the chain head, or identifier status.
- Test identifiers obey the same append-only rules as production identifiers
  while TII semantics are being exercised. A deliberate development reset is a
  disposable-environment reset, stated as such — not a valid TII history
  mutation.

## 8. Identifier syntax (provisional)

Every value in this table is **not yet finalized**.

| Item | Provisional value |
|---|---|
| Namespace | `tii:` |
| Body | 12 characters |
| Allowed characters | `0-9 a-h j k m n p-t v-z` (Crockford-style; no `i l o u`) |
| Case | lowercase; compared in lowercase |
| Generation | CSPRNG with rejection sampling (no modulo bias) |
| Collision handling | checked against the whole ledger; retried; error on exhaustion |
| Resolution URL | `<resolver base>/tii/<id>` — the resolver base is a configuration value, not part of the identifier |
| Revocation / transfer | recorded as events; the identifier string is retained |

The identifier is opaque. It must not embed an organization, person, owner,
year, place, country, category, document type, version, address, domain, theory,
ignition state, or transition state.

## 9. Test identifiers

Until §8 is finalized and the pre-production audit (below) passes, all issued
identifiers carry `identifier_status: "test"`. Promotion to production status
does not change the identifier string.

## 10. Portability

- The record of authority is `data/ledger.jsonl` (append-only, one event per
  line, UTF-8).
- Exports: JSON, JSON Lines, CSV.
- The complete set of records can be reconstructed as a static file tree with no
  server, database, or cloud service.
- If the hosting provider, database product, or domain changes, previously
  issued identifiers are unaffected and the records rebuild identically.
- Re-implementation must not require any provider's proprietary features.

## 11. Pre-production audit

Before the first production identifier is issued, §8 must be finalized and the
following confirmed:

- differences from existing PIDs (DOI, ARK, DID, content hashes, provenance
  records) are not overstated, and those systems are not misrepresented;
- state, transition, ignition, placement, address, domain, and boundary are not
  ontologized;
- ownership is not reintroduced as a fixed attribute;
- categories such as AI / human / organization are not made primary;
- the TII data model is not more rigid than the theories it serves;
- a future revision of TII's own vocabulary can be made while previously issued
  identifiers remain valid;
- full migration away from any single cloud provider is possible;
- history tampering is detectable;
- corrections and deletions never lose the earlier record.

If a regression is detected, production issuance stops.
