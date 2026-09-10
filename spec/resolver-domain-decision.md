# Permanent Resolver Domain — Decision Report

> **No domain has been selected, purchased, or configured. No DNS was changed.**
> This report returns availability, pricing, portability, and conflict analysis
> so the decision can be made deliberately, with authorization, later. The
> current deployment host `tiiarchive.vercel.app` is a **deployment endpoint
> only** and MUST NOT be treated as the permanent resolver identity or written
> into any production identifier or identity metadata (see §7).

Checks in this report were performed **2026-09-11**. Registration state and
pricing change; both MUST be re-verified immediately before any purchase.

---

## 1. Why the domain is decoupled from the identifier

The identifier is resolver-independent (`identifier-syntax-1.0-candidate.md` §9):
`tii:<token>` contains no hostname. The resolution URL
`https://<domain>/tii/<token>` is an access mechanism. Choosing, changing, or
losing the domain has **zero effect on any issued identifier**. The domain is
long-lived infrastructure, not identity; it can be selected after first
production issuance and changed again later.

## 2. Candidate availability (RDAP, 2026-09-11)

Checked via RDAP (`rdap.org` → PIR `.org` RDAP); a `404` response means the
domain does not exist in the registry (RFC 7480 §5.3) — i.e. available.
Control checks `iana.org` and `example.org` returned registration data as
expected, confirming the method.

| Candidate | RDAP result | Available? |
|---|---|---|
| `tii-id.org` | HTTP 404 — no registry object | **Available** |
| `tii-reference.org` | HTTP 404 | **Available** |
| `tii-identifier.org` | HTTP 404 | **Available** |
| `tii-registry.org` | HTTP 404 | **Available** |
| `tii-resolver.org` | HTTP 404 | **Available** |
| `transition-ignition-id.org` (added, §4) | HTTP 404 | **Available** |

"Available" here means *unregistered as of the check*. It does **not** rule out
registrar-side premium classification, a pending registration, or a trademark
claim — all of which MUST be checked at purchase time.

## 3. Pricing, registrar, DNSSEC, transfer (representative — confirm at purchase)

None of these strings is a registry-level premium name; `.org` (PIR) has no
premium tier for ordinary hyphenated strings. If a registrar quotes a "premium"
price for one of these, that is a registrar-side classification — choose a
registrar that prices it as a standard `.org`.

| Registrar | Approx. `.org` reg / renewal (USD/yr) | DNSSEC (DS mgmt) | Transfer | Notes |
|---|---|---|---|---|
| Cloudflare Registrar | ~10.44 / ~10.44 (at cost, no markup) | yes | standard auth-code; no add-on fees | requires Cloudflare DNS; strong registrar-lock + 2FA; no upsells |
| Porkbun | ~11 / ~11 | yes | standard auth-code | free WHOIS privacy; API |
| Namecheap | ~10–13 promo / ~15–16 | yes | standard auth-code | renewal higher than first year |
| Gandi | ~16–24 / ~16–24 | yes | standard auth-code | higher price; strong transfer/ethics record |
| **Vercel domains** | resells (varies) | — | — | **do not use** — see §7 / registrar-independence audit |

`.org` registry facts (stable, not registrar-specific):

- **DNSSEC**: fully supported by PIR for `.org`; all registrars above accept DS
  records.
- **Transfer**: ICANN 60-day lock after initial registration / after a prior
  transfer; thereafter standard EPP **authorization-code** transfer between any
  accredited registrars. Owner can toggle `clientTransferProhibited`
  (registrar-lock).
- **Term**: up to 10 years total registration; renew for the maximum term and
  set auto-renew plus independent reminders.
- **TLD longevity**: PIR is an established non-profit registry with a long
  operating history and modest, historically-capped price movement. No
  speculative-TLD delisting risk.

Initial and renewal prices, and any registrar premium flag, MUST be re-quoted at
purchase for the specific chosen name.

## 4. Domain candidate comparison

| Candidate | Meaning read | Length | "TII" abbrev collision exposure (§5) | Depends on P/A / theory / host? | IANA-doc suitability | Semantic-obsolescence risk | Verdict |
|---|---|---:|---|---|---|---|---|
| `tii-id.org` | "TII identifier" | 10 | **moderate** — leads with bare `tii`; nearest large user is Technology Innovation Institute (Abu Dhabi), a crypto/AI research body | no | good (short, clear) | low | **PRIMARY (conditional)** |
| `transition-ignition-id.org` | full scheme name + "id" | 25 | **minimal** — "transition-ignition" is unique to this project | no | **best** — spells the scheme's defining name | low | **FALLBACK** |
| `tii-registry.org` | "TII registry" | 16 | moderate (same `tii` lead) + "registry" implies a service that may later be run by a successor, not P/A specifically — acceptable, but "registry" narrows the concept | no | fair | low–moderate ("registry" is one function of the resolver) | rejected (redundant with primary; "registry" over-narrows) |
| `tii-resolver.org` | "TII resolver" | 16 | moderate | no | fair | **moderate** — "resolver" is exactly the replaceable layer; a domain named after the replaceable layer ages oddly if resolution mechanics change | rejected |
| `tii-reference.org` | "TII reference" | 17 | moderate | no | fair | low | rejected (no advantage over primary; longer) |
| `tii-identifier.org` | "TII identifier" (spelled) | 18 | moderate | no | good | low | acceptable alternate to primary; longer, same collision profile — not preferred |

Added candidate `transition-ignition-id.org` is materially justified: it removes
almost all abbreviation-collision exposure (§5) and is the most appropriate
string to cite in IANA documentation, at the cost of length. Length is a
low-priority factor for a resolver domain — the domain is rarely typed by hand
(the identifier is `tii:<token>`, not the URL; resolution URLs are clicked or
copied).

Rejected on principle: anything with `pa-` / `platodesign` / `plato` (ties to
the current steward — §8, §25), anything with `ziran` or a version/year
(theory-version or dated), anything on a hosting-provider subdomain, and
`.io`/new-gTLD options (ccTLD geopolitics / thin-registry risk). `.org` is the
right TLD.

## 5. Brand-collision audit — "TII"

"TII" is a **crowded abbreviation**. Documented users include:

- **Technology Innovation Institute (TII)** — Abu Dhabi, `tii.ae`; a large,
  government-funded research institution active in **cryptography, secure
  systems, AI, quantum**. This is the most prominent collision and the one that
  matters: it is adjacent in subject area (cryptographic infrastructure) and
  well-resourced.
- Technology International, Inc. (TII); Semantic Technology Institute
  International; the Textile Institute; various "…Institute International"
  bodies.

**Position.** TII (this project) claims **no exclusive right to the bare
abbreviation "TII"**. The identity is **Transition-Ignition Identifier**. The
resolver domain must not plausibly imply affiliation with Technology Innovation
Institute or any other "TII".

**Assessment of `tii-id.org`:** the risk is **material but not clearly
disqualifying**. Mitigating: it is not the bare `tii.org`; `tii.ae` is that
institute's domain and it operates in `.ae`; "-id" plus resolver content that
says "Transition-Ignition Identifier" on every page disambiguates. Aggravating:
same subject vicinity (crypto), and a hyphenated `tii-*` `.org` could be read by
someone as "TII's identifier service".

**Required before registering `tii-id.org`:** a proper trademark / confusion
clearance search — at minimum USPTO TESS, EUIPO eSearch, WIPO Global Brand
Database, and a UAE mark check — for "TII" and "TII-ID" in the relevant Nice
classes (9, 35, 42, 45). If a blocking or plausibly-confusing mark is found in a
namespace / identifier / software / standards class, **do not register
`tii-id.org`; use the fallback.** This search is outside the scope of this task
and has **not** been performed here.

## 6. Preferred URL structure (audited, for a future approved domain)

```
https://<domain>/                 public homepage
https://<domain>/tii/<token>      canonical web resolution page
https://<domain>/registry         public registry
https://<domain>/spec             current specification
https://<domain>/audit            audit / verification information
https://<domain>/about            governance / stewardship  (see governance-candidate.md)
https://<domain>/ja/...           Japanese localization (already implemented)
```

- **Apex for primary resolution.** Serve everything from the apex
  (`<domain>/tii/<token>`). No `resolver.` / `id.` / `www.` subdomain is
  needed; `www` should 301 to the apex.
- **No permanent subdomains** unless a concrete technical need appears (e.g. a
  separate static asset host). Subdomains add DNS surface and migration cost.
- This is exactly the structure the current app already serves at relative
  paths; adopting the domain is a configuration change, not a code change.

## 7. Hosting / domain / identifier separation — audit result

| Layer | Value | Mutability |
|---|---|---|
| Identifier | `tii:<token>` | **immutable once issued** |
| Permanent web resolver | `https://<domain>/tii/<token>` | long-lived; replaceable |
| Hosting provider | Vercel (now); any provider later | freely replaceable |
| Registrar, DNS operator, runtime, database, repository | current choices | freely replaceable |

**Code audit for resolver-domain assumptions (2026-09-11):**

- The resolver base has **exactly one authoritative source**: the environment
  variable `TII_RESOLVER_BASE_URL`. It is read at the two process entry points —
  `src/server.js` (runtime resolver) and `src/export.js` (`buildStaticSite`) —
  each defaulting to `''` (relative links). `src/candidate/identifier.js`
  `resolutionUrl()` takes the base as a **parameter**, not from the environment.
- Every other `/tii/…` in the codebase is a **relative** path
  (`/tii/<slug>`, `/tii/<slug>.json`), which resolves correctly under any
  domain.
- **No hostname is hard-coded** anywhere in `src/`, `bin/`, or `vercel.json`.
  `vercel.json` contains no domain and no `TII_RESOLVER_BASE_URL`.
- **`data/ledger.jsonl` contains zero occurrences of `vercel`** or any hostname
  (verified). Production `/catalog.json` reports `"resolver_base": ""`.
- Conclusion: changing the domain later means setting one environment variable
  and redeploying. Nothing else. No code change, no identifier change.

**Confirmed:** no production-facing irreversible configuration embeds
`tiiarchive.vercel.app`. It appears only as the Vercel *project deployment URL*
(a platform artifact), never in the repo, the ledger, exports, the spec's
normative text, or identity metadata.

## 8. Registrar-independence requirements (before purchase)

- Outbound transfer supported via standard EPP auth code — **yes** for all
  registrars in §3 and for `.org`.
- Ownership/control registered to the **designated operator** (the current
  steward organization), not to an individual and not to a hosting account.
- DNS delegable to any operator (the registrar's nameservers are not mandatory).
- Hosting changeable independently of the registrar.
- Registrar-lock (`clientTransferProhibited`) understood: owner-toggluable;
  leave **on** except during an intended transfer.
- **Do not register through Vercel** even though it offers domains — it couples
  the domain account to the hosting account and adds an unnecessary transfer
  step.

## 9. DNS plan (deployment-neutral — not deployed)

For a future approved domain, hosted initially on Vercel, portable to anything:

| Record | Value | Rationale |
|---|---|---|
| Apex `A` / `AAAA` **or** `ALIAS`/`ANAME` | current host's documented apex target | keep TTL moderate (300–3600 s) so a host move propagates quickly |
| `www` `CNAME` | apex (or host target) + a 301 `www → apex` at the app | one canonical host |
| `CAA` | `0 issue "letsencrypt.org"` (+ the host's CA if different); `0 iodef "mailto:security@<domain>"` | limit who can issue certs |
| DNSSEC | signed zone; publish DS at the registrar | tamper-evident delegation |
| `TXT` (later) | domain-verification records as needed | host verification |
| Mail (`MX`, `SPF`, `DKIM`, `DMARC`) | **only if** role email is later approved (§10, governance) | not now |

- No host-proprietary apex features; keep records standard so the zone can move
  registrar and DNS operator together or separately.
- **No DNS changes are made by this task.**

## 10. HTTPS & resolution behaviour (for the approved domain)

- HTTPS **required**. Plain HTTP 301-redirects to HTTPS. HSTS after the domain
  is stable (start with a short `max-age`, raise later; add to the preload list
  only once committed).
- Resolution responses (mirrors `identifier-syntax-1.0-candidate.md` §10):

| Request | Response |
|---|---|
| `GET /tii/<valid active token>` | `200`, resolution page / structured data |
| `GET /tii/<withdrawn token>` | `200` (or `410` + body) — tombstone status; **never a bare `404`** |
| `GET /tii/<unknown token>` | `404` + body: "not issued in this deployment" — distinct from withdrawn |
| `GET /tii/<syntactically invalid input>` | `400` + the parse-error code — distinct from `404` |
| `#fragment` in the request | stripped before lookup (RFC 3986); lookup by the fragmentless token |

- HTTP availability is **not** identifier validity. A `200` from the resolver
  does not make a TII valid; a `404`/outage does not make it invalid.

## 11. Operational requirements once a domain is chosen

- Register for the maximum term; auto-renew **plus** independent reminders held
  by more than one steward representative.
- Registrar-lock **on**; account 2FA **on**; DNSSEC signed and DS published.
- Record domain, registrar, DNS operator, renewal date, and account recovery
  path in the succession kit (`succession-policy.md` §1,
  `domain-failure-and-recovery.md`).
- Set `TII_RESOLVER_BASE_URL=https://<domain>` in the deployment environment —
  the single configuration point. The domain is data, not code.

## 12. Final domain decision table

| Candidate | Availability (2026-09-11) | Init price* | Renewal price* | Registrar portability | DNSSEC | Collision risk | Conceptual durability | Institutional neutrality | Recommended / rejected | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| `tii-id.org` | Available | ~$10–13 | ~$10–16 | full (EPP auth code) | yes | **moderate** (Technology Innovation Institute, `tii.ae`) | high | high | **PRIMARY — conditional on trademark clearance** | shortest clear name; portable; cheap; only blocker is an unperformed confusion-clearance search |
| `transition-ignition-id.org` | Available | ~$10–13 | ~$10–16 | full | yes | **minimal** | high | high | **FALLBACK** | unambiguous; best for IANA docs; longer, which is a low-priority cost |
| `tii-identifier.org` | Available | ~$10–13 | ~$10–16 | full | yes | moderate | high | high | alternate | same collision profile as primary, longer, no upside |
| `tii-reference.org` | Available | ~$10–13 | ~$10–16 | full | yes | moderate | high | high | rejected | no advantage over primary |
| `tii-registry.org` | Available | ~$10–13 | ~$10–16 | full | yes | moderate | moderate | high | rejected | "registry" over-narrows the concept |
| `tii-resolver.org` | Available | ~$10–13 | ~$10–16 | full | yes | moderate | **moderate** | high | rejected | names the domain after the replaceable layer |

\* Representative `.org` pricing across the registrars in §3; **must** be
re-quoted for the specific name at purchase.

### PRIMARY RECOMMENDATION

**`tii-id.org`** — *conditional on* a trademark / confusion clearance search
(§5) completing without a blocking or plausibly-confusing mark for "TII" /
"TII-ID" in namespace / identifier / software / standards classes, with
particular attention to Technology Innovation Institute (Abu Dhabi). If that
search is not done, or flags a conflict, use the fallback.

### FALLBACK RECOMMENDATION

**`transition-ignition-id.org`** — no material abbreviation-collision exposure,
best suited to IANA documentation, at the cost of length. Use this if the
trademark clearance for `tii-id.org` is unavailable, inconclusive, or negative,
or if the steward simply prefers zero abbreviation ambiguity.

**Neither domain is to be registered without explicit authorization.** No domain
was registered, and no DNS was changed, by this task.
