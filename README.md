# TII — Transition-Ignition Identifier

遷移発火識別子

A reference and audit infrastructure for recording **how distinctions, relations,
functions, and classifications become operative under specified conditions**, and
how those recorded conditions, addresses, interpretations, and relations change
over time.

Issuing a TII means only one thing: **tracking has started from a stated
reference point.** TII is not permanent object numbering, and it is not an
ontology that treats state, transition, ignition, address, domain, boundary,
lineage, or ownership as universal units — these are optional, revisable
operational descriptions. TII operates *below* research architectures such as the
Ziran System.

> The specification is experimental (`0.1.x`). Every identifier issued by this
> implementation carries `identifier_status: "test"` until the pre-production
> conditions in [SPEC.md](SPEC.md) §8 are finalized.

- [SPEC.md](SPEC.md) / [SPEC.ja.md](SPEC.ja.md) — public specification
- [ABOUT.md](ABOUT.md) / [ABOUT.ja.md](ABOUT.ja.md)
- [DESIGN.md](DESIGN.md) — pre-implementation design notes

## Public interface

English-first; Japanese is a separate localized rendering under `/ja`.

| Route | Purpose |
|---|---|
| `/` | Resolver entry point (search + short description) |
| `/registry` | Publicly recorded identifiers; test identifiers marked |
| `/tii/<id>` | **Resolution page** — the core public unit. `.json` / `/data` for structured data |
| `/spec` · `/about` | Specification · About |
| `/audit` | Ledger integrity, hash-chain status, exports |
| `/admin` | Issue / append / verify (technical; not in public nav) |

The resolution page shows only sections that have records — no empty module
blocks, and no fabricated "current state".

## Architecture (unchanged core)

| Concern | Implementation |
|---|---|
| Thin core | 10 required fields only; modules are conventions over `content.module/ref/act` |
| Append-only | `data/ledger.jsonl`, one event per line; corrections are new events via `supersedes` |
| Audit | SHA-256 hash chain (`prev_hash` + canonical JSON). No blockchain |
| Open vocabulary | unknown `event_type` / `module` / `act` stored and shown verbatim |
| Separation | evidence (`basis`) / judgement (`recorder` + `content`) / display (`projection.js`) |
| Portability | zero dependencies (Node stdlib); JSON / JSONL / CSV export; static-site rebuild |

### Localization — no display-driven mutation

Changing the interface language never rewrites a canonical event. A translation
is an **appended** `localization.added` event:

```jsonc
{ "event_type": "localization.added",
  "content": { "module": "localization", "source_event": "evt_…",
    "source_language": "ja", "target_language": "en", "kind": "literal",
    "translated_content": { "description": "…" } } }
```

`projection.displayContent(projection, event, lang)` picks the representation to
show — a localization for `lang` if one exists, otherwise the authored content —
and returns a **new object**; it never writes to the ledger. A later
`localization` event for the same source + language supersedes the earlier one,
which is retained. There are no `description_en` / `description_ja` core fields;
any language can be added later with no schema change. See SPEC.md §6–§7.1 and
`test/ledger-integrity.test.js`.

## Use

```bash
node --test          # 66 tests: core + 25 destruction + 15 interface + 11 ledger-integrity
npm start            # http://localhost:3009
```

```bash
node bin/tii.js issue --recorder me --note "reference point"
node bin/tii.js append --file event.json
node bin/tii.js show tii:xxxxxxxxxxxx
node bin/tii.js verify
node bin/tii.js export jsonl > backup.jsonl
node bin/tii.js rebuild-static public
```

### Environment

- `PORT` (default 3009)
- `TII_LEDGER` (default `data/ledger.jsonl`)
- `TII_ADMIN_TOKEN` — if set, writes require `X-TII-Token` / `token`
- `TII_RESOLVER_BASE_URL` — resolver base shown on resolution pages; **not** part
  of any identifier. Leave unset for relative links. Do not embed a hosting host.

## Deployment (static read-only mirror)

The record of authority is a single append-only file. Serverless filesystems are
read-only and ephemeral, so `src/server.js` (the writable server) is for local /
self-hosted use with a persistent volume.

Vercel serves a **static, read-only mirror** built from the committed ledger:

- `data/ledger.jsonl` is committed (the published record).
- Build: `node bin/tii.js rebuild-static public` ([vercel.json](vercel.json)),
  which emits English at the root, Japanese under `/ja`, plus
  `/ledger.{jsonl,json,csv}` and `/catalog.json`.
- Issuance and events happen via the local CLI, then `git push` redeploys.

Changing the hosting provider or domain does not change any identifier.
