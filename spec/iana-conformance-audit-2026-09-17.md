# IANA registration conformance audit (2026-09-17)

With `tii` now registered (`spec/production-launch-gate.md`'s "G9 final
closure", 2026-09-15), its own template page
(`https://www.iana.org/assignments/uri-schemes/prov/tii`) is the
authoritative statement of the scheme's normative requirements:

> The canonical form is `tii:<token>`. The token is opaque. HTTPS
> resolution infrastructure is separate from identifier identity. URI
> fragments follow generic RFC 3986 URI-reference semantics and are not
> part of the TII token.

This document audits the codebase against that text, item by item, and
records what was found and fixed. It does not change G1–G14 gate status
— G1 (identifier syntax) and G7 (resolver) were already PASS and remain
PASS; this is a within-scope conformance fix, not a gate reopening.

## 1. Canonical form `tii:<token>`

**Conformant, no change.** Both identifier profiles produce exactly this
form: `src/id.js` (test profile, 12-character body — what every
identifier actually issued today uses) and `src/identifier.js`
(production profile, 26-character body, frozen but gated closed). Neither
embeds anything beyond the scheme prefix and the opaque body.

## 2. Token opacity

**Conformant, no change.** Confirmed by existing tests
(`test/identifier.test.js`'s "no semantic metadata" test) and this
audit's new equivalent for the test profile
(`test/id-syntax.test.js`'s "no semantic metadata" test): a token is a
function of random bytes only, never of time, sequence, or any
descriptive field.

## 3. HTTPS resolution separate from identifier identity

**Conformant, no change.** `resolver_base` (`TII_RESOLVER_BASE_URL`) is
deployment configuration, carried as a separate field alongside
identifiers in every export (`catalog.json`, per-identifier JSON) — never
concatenated into or embedded in a `tii:` string. Confirmed by this
audit's new test (`test/resolver.test.js`, "never embeds the resolver
domain into an identifier") and the pre-existing cross-host resolution
test (identical result regardless of the `Host` header).

## 4. RFC 3986 fragment semantics — FOUND NON-CONFORMANT, FIXED

**`src/identifier.js` (production profile) was already fully conformant**
— `parseTIIReference`, `canonicalize`, `isTIIReference`, and
`resolutionUrl` all correctly split a trailing `#fragment` before any
TII-specific processing, per `test/identifier.test.js`'s existing
"RFC 3986 fragment handling" test.

**`src/server.js`'s live resolver was not.** `resolveIdentifier()` — used
by both the path-based route (`GET /tii/<slug>`, where HTTP itself never
delivers a fragment to the server, so this path was incidentally
conformant by construction) and the search-form route (`GET
/resolve?tii=<input>`, where a user-typed value legitimately can and did
contain a literal `#`) — performed no fragment splitting at all. A
reference like `tii:h4r3jsn4p25d#note`, submitted through the resolve
form, failed to resolve an identifier that genuinely exists, because the
full string (fragment included) was compared against the ledger's exact
`tii:h4r3jsn4p25d`.

Reproduced directly before any fix:
```
resolveIdentifier('tii:h4r3jsn4p25d')        -> 'tii:h4r3jsn4p25d'   (correct)
resolveIdentifier('tii:h4r3jsn4p25d#note')   -> null                 (WRONG — the identifier exists)
```

**Fix** (`src/server.js`): `resolveIdentifier()` now splits off
everything from the first `#` onward — the fragment — before any lookup,
exactly mirroring `identifier.js`'s already-correct semantics, applied at
the resolver layer so it works uniformly for both identifier profiles
without needing profile-specific fragment logic (resolution is a generic
string lookup regardless of which profile issued the token). No ledger
schema change, no new terminology, no redesign of the identifier scheme —
the smallest fix that closes the gap.

Proven by 8 new tests in `test/resolver.test.js`, spun up against the
real `src/server.js` HTTP server (not a re-implementation): a
fragment-bearing reference resolves identically to its fragment-free
form; different fragments on the same base (`#a` vs `#b`) resolve to the
identical result (the fragment carries no scheme-specific semantics, per
the registration text); an unknown token with a fragment still correctly
404s (fragment-stripping never produces a false positive); a bare `#`
does not crash the resolver.

## 5. Test coverage gap closed

`src/id.js` (the profile every real identifier actually uses) previously
had only incidental test coverage (a couple of assertions inside
`test/core.test.js`) and no dedicated negative-case testing at all —
unlike `src/identifier.js`, which already had 19 thorough tests. Added
`test/id-syntax.test.js` (12 tests) bringing it to the same standard:
malformed-input rejection (wrong length, excluded look-alike characters,
case sensitivity, fragment-bearing input), collision-predicate handling,
generation uniqueness at scale, and `tiiToFileSlug` robustness.

## 6. Registry API parity

The deployed static mirror already serves a machine-readable registry
listing (`catalog.json`, `src/export.js` `buildStaticSite()`). The live
dynamic server (`src/server.js`, used for local development and any
future non-static deployment) had no equivalent — only the HTML
`/registry` page. Added `GET /catalog.json` to `src/server.js`, reusing
the exact same `summariesForRegistry()` function the HTML page already
uses, so a consumer gets identical data regardless of deployment mode.
Proven by 2 new tests in `test/resolver.test.js`.

## Summary

| Requirement | Status before | Status after |
|---|---|---|
| Canonical form `tii:<token>` | Conformant | Unchanged |
| Token opacity | Conformant | Unchanged |
| Resolver separate from identity | Conformant | Unchanged |
| RFC 3986 fragment semantics | **Non-conformant** (live resolver only) | **Fixed** |
| Test profile parser/validator coverage | Sparse | Thorough (12 new tests) |
| Registry API (live server) | Missing JSON endpoint | Added (`/catalog.json`, 2 new tests) |

Full test suite: 214/214 passing (192 prior + 22 new). Canonical ledger
unchanged throughout. No identifier-syntax change, no new terminology, no
production issuance, no gate status change (G1 and G7 remain PASS, as
they already correctly were for the identifier-syntax and
domain/HTTPS/routing facts they respectively cover).
