# Duplicated TII interpretation code paths — audit and consolidation (2026-09-17)

Full audit of the codebase for independent code paths that can interpret
or transform a `tii:` reference (parsing, validation, normalization,
fragment handling, serialization, resolution), against the now-registered
IANA `tii` semantics
(`https://www.iana.org/assignments/uri-schemes/prov/tii`) as authoritative.

Follows directly from `spec/iana-conformance-audit-2026-09-17.md`, which
found and fixed the SAME fragment-handling bug independently reimplemented
(and drifted) in two places. This audit generalizes that finding: find
every such code path, classify each, and eliminate drift risk by
extraction where it is safe to do so.

## Every code path found

| # | Location | What it does | Classification |
|---|---|---|---|
| 1 | `src/id.js` `newTII`/`isWellFormedTII` | Generates and validates the 12-character PROVISIONAL test-profile body | **Normative** — the test profile's own syntax rules |
| 2 | `src/identifier.js` `parseCanonicalTII`/`parseTIIReference`/`canonicalize`/`isWellFormed`/`isTIIReference`/`resolutionUrl` | Generates, strictly parses, and canonicalizes the 26-character PRODUCTION profile, including full RFC 3986 fragment handling | **Normative** — the frozen production profile's own syntax rules; already correct, already tested (`test/identifier.test.js`, pre-existing) |
| 3 | `src/id.js` `tiiToFileSlug` | Converts any `tii:` string to a filesystem-safe slug | **Shared, profile-agnostic** — already correctly used as a single implementation everywhere (`src/export.js`, `src/server.js`, `src/views.js`). No drift found; no change made. |
| 4 | `src/server.js` `resolveIdentifier()` | Loose, best-effort lookup for the dynamic resolver (`/resolve?tii=`, `/tii/<slug>`) | **Derived / convenience** — was an ad-hoc reimplementation of fragment-splitting; **now uses the shared primitive** |
| 5 | `src/views.js` `homePage()` inline `<script>` | Loose, best-effort lookup for the STATIC site's client-side redirect — the code path the deployed production site actually runs | **Derived / convenience** — was a second, independently drifted reimplementation (the actual live bug fixed earlier today); **now embeds the shared primitive's exact source** |
| 6 | `bin/tii.js` `show`/`events` | CLI convenience lookup by TII | **Derived / convenience** — previously did zero normalization at all (a third, silent variant: neither case-insensitive nor fragment-tolerant); **now uses the shared primitive** |
| 7 | `src/ledger.js` `tiiExists`/`forTII`/`getEvent` | Exact-string-match lookups against canonical ledger state | **Normative, unchanged** — correctly exact-match only; loose/fuzzy interpretation must never leak into the ledger layer. Not modified, per the task's explicit instruction not to touch the ledger. |
| 8 | `src/projection.js` | Reads `event.tii` as an opaque string, never transforms it | Not a code path that interprets a reference — no action needed |
| 9 | `src/export.js` `buildStaticSite`/`publicSummary` | Iterates already-canonical `ledger.listTIIs()` values; does not accept or interpret arbitrary user input | Not a code path that interprets a reference — no action needed |

## Classification principle

Two genuinely different kinds of "interpreting a tii: reference" exist,
and conflating them would be a mistake, not a fix:

- **Normative validation** (#1, #2): "is this string a well-formed
  identifier under a specific profile's frozen rules" — alphabet, length,
  canonical Base32 tail. This is inherently profile-specific (the two
  profiles have different alphabets and lengths) and must stay separate;
  merging them would require changing token format, which this task
  explicitly forbids.
- **Loose resolver-layer lookup** (#4, #5, #6): "a human typed or pasted
  something that looks like a reference — help it resolve anyway,
  tolerant of case and a trailing fragment." This has nothing to do with
  either profile's alphabet; it is pure string handling and applies
  identically regardless of which profile issued the token. This is
  exactly where duplication had — and would keep — drifted, and exactly
  what was safe to extract.

## The extraction: `src/tii-lookup.js`

One new function, `splitFragment(input)`: trims, lowercases, and splits
off a trailing `#fragment` per RFC 3986 §3.5. Nothing else — it is
deliberately not a validator and must never become one (see the module's
own doc comment for the explicit warning against scope creep back into
normative territory).

Consumed by:
- `src/server.js` `resolveIdentifier()` — via `require('./tii-lookup')`.
- `bin/tii.js` `show`/`events` — via `require('../src/tii-lookup')`,
  closing a previously-undetected THIRD variant (no normalization at
  all) at the same time.
- `src/views.js` `homePage()` — not merely called, but its **exact
  source text** (`splitFragment.toString()`) is embedded into the
  generated `<script>` tag. This is the strongest form of consolidation
  available for a browser-embedded code path with no build step and no
  new dependency: the static site's actual served bytes and the dynamic
  server's actual executed bytes are provably the same function, not two
  functions kept in sync by discipline. A regression test
  (`test/tii-lookup.test.js`) asserts the embedded script contains
  `splitFragment.toString()` verbatim — if a future edit reintroduces a
  hand-written duplicate here, that test fails immediately.

## What was deliberately NOT touched

- `src/identifier.js` and `src/id.js`'s own parsing/generation logic —
  zero changes. Their fragment/case handling (already correct in
  `identifier.js`) is strict-validation semantics, not loose-lookup
  semantics, and must not be routed through the loose primitive (doing so
  would silently forgive exactly the whitespace/case anomalies
  `parseCanonicalTII` exists to reject with specific error codes).
- `src/ledger.js` — exact-match lookups unchanged. Fuzziness belongs only
  at the resolver layer, never inside the record of authority.
- Token format, canonical form, identifier syntax, ledger schema,
  production-issuance gate state — none of these were touched. This is a
  code-organization fix (duplication → shared primitive) plus a UX-layer
  bug fix (fragments, already fixed and deployed earlier today), not a
  redesign.

## Regression tests

`test/tii-lookup.test.js` (12 tests): `splitFragment()`'s own behavior
(fragment splitting, case-folding, idempotence, non-string coercion,
empty/whitespace input); static assertions that `server.js` and
`bin/tii.js` import the shared module rather than reimplementing it; the
byte-identity assertion on the embedded client-side script; and a
real-subprocess CLI test proving `tii show`/`tii events` now resolve a
fragment-bearing reference the same as the bare form.

`test/resolver.test.js` (+1 test, "EQUIVALENCE — static production build
and dynamic server resolve an identical input matrix to the identical
outcome"): builds the real static site (`exporters.buildStaticSite()`)
and boots the real dynamic server from the **same seeded ledger**, then
drives both with an identical 7-input matrix (bare, uppercase, fragment,
bare fragment marker, incidental whitespace, unknown token, unknown token
with fragment) and asserts both produce the identical outcome for every
input — this is the direct proof that the static production build and
the dynamic server interpret the same TII references identically, using
the real build artifact and the real running server, not
re-implementations of either.

## Result

Full test suite: 231/231 passing (218 prior + 13 new: 12 in
`test/tii-lookup.test.js`, 1 equivalence test in `test/resolver.test.js`).
Canonical ledger unchanged throughout (10 events, same SHA-256). No
identifier-syntax change, no token-format change, no canonical-form
change, no ledger change, no production-issuance state change. G1 and G7
remain PASS — unaffected, since this reorganizes already-correct-or-
already-fixed behavior rather than changing what either gate verified.
