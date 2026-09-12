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

## 13. Production Launch Gate re-check (2026-09-11) — appended, nothing above erased

Re-checked live as launch gate **G7** in `spec/production-launch-gate.md`,
using the same RDAP method as §2 above, validated against a known-registered
control domain (`example.org`, which returned live registration data,
confirming the method distinguishes registered from unregistered correctly):

| Candidate | RDAP result (2026-09-11, this phase) | Available? |
|---|---|---|
| `transition-ignition-id.org` | HTTP 404 — no registry object | **Available** |
| `tii-id.org` | HTTP 404 — no registry object | **Available** |

Both remain available, unchanged from §2/§12 above. This phase's launch-gate
task framed `transition-ignition-id.org` as the **PRIMARY BRAND-SAFETY
CANDIDATE** and `tii-id.org` as **SECONDARY** — consistent with, not
contradicting, §12's PRIMARY/FALLBACK recommendation above: `tii-id.org`'s
PRIMARY status there was always explicitly conditional on an unperformed
trademark clearance search (§5), and `transition-ignition-id.org` was
already identified as having minimal collision exposure. Given that search
remains unperformed as of this re-check, this document's operative
recommendation is: **use `transition-ignition-id.org` unless and until a
trademark clearance search clears `tii-id.org`.**

**Still not registered. No DNS changed. No purchase made or authorized by
this task.** G7 status in the launch-gate table: **CONDITIONAL PASS** — the
decision framework and current availability are both confirmed; only an
explicit purchase authorization (outside this task's authority) and,
for `tii-id.org` specifically, the trademark clearance search, remain.

## 14. External Infrastructure Closure re-check (2026-09-11, same day) — appended, nothing above erased

### 14.1 Fresh RDAP re-check

Performed again, independently, in this phase — not reused from §13. Method
validated the same way: a live, known-registered control domain
(`iana.org`) was queried in the same session and returned full registration
data (`status: ["server delete prohibited", "server transfer prohibited",
"server update prohibited"]`, no `errorCode`), confirming the RDAP endpoint
correctly distinguishes registered from unregistered domains at the moment
of this check.

| Candidate | RDAP `errorCode` | Result |
|---|---|---|
| `transition-ignition-id.org` | `404` | **CONFIRMED AVAILABLE** |
| `tii-id.org` | `404` | **CONFIRMED AVAILABLE** |

Neither status is reported as UNKNOWN — the control check succeeded and
both candidate lookups returned an unambiguous, machine-readable "object
not found" response from the registry itself (Public Interest Registry's
RDAP service), not a network error, a timeout, or an ambiguous page.

### 14.2 Domain decision — re-audited, frozen this phase

This task's framing designates `transition-ignition-id.org` **PRIMARY**
and `tii-id.org` **SECONDARY**, reasoning: `tii-id.org` leads with the bare
`tii` string, which is the exact abbreviation used by Technology
Innovation Institute (Abu Dhabi, `tii.ae`) — an adjacent, well-resourced
research body in the same general subject area (cryptography, secure
systems). `transition-ignition-id.org` spells out the full scheme name and
carries no material collision exposure with any identified third party.
This reorders, but does not contradict, §12's PRIMARY (conditional)/
FALLBACK table above — that table's own PRIMARY was already explicitly
"conditional on trademark clearance," which was never performed and is
still not performed. Re-auditing the full criteria set today:

| Criterion | `transition-ignition-id.org` | `tii-id.org` |
|---|---|---|
| Current availability (2026-09-11, this check) | Available | Available |
| First-year price (representative, `.org`) | ~$10–13 | ~$10–13 |
| Renewal price (representative) | ~$10–16 | ~$10–16 |
| Registrar | not yet selected — see §14.3 | same |
| Transfer-out support | standard EPP auth-code, any accredited registrar | same |
| DNSSEC | supported (PIR `.org`) | same |
| Registrar lock | owner-toggleable at any credible registrar | same |
| WHOIS/RDAP behavior | standard PIR RDAP, confirmed working (§14.1) | same |
| Account recovery / 2FA / hardware-key | depends on registrar choice, not the domain — see §14.3 | same |
| DNS portability | full — no registrar-mandated DNS | same |
| Hosting portability | full — domain and host are independent | same |
| Spelling stability | long, but unambiguous and stable — no abbreviation to misremember | short; "tii-id" could be mis-typed as "tii.id" or similar |
| Long-term conceptual durability | high — names the scheme itself | high, but tied to an abbreviation shared with unrelated orgs |
| Trademark / confusion exposure | **minimal** | **moderate — unresolved**, requires a clearance search not performed by this or any prior task |
| Institutional neutrality | high — no tie to P/A Institute, hosting, or theory | high, same structural property, but weaker on the collision axis |

**FINAL RECOMMENDED DOMAIN: `transition-ignition-id.org`.**
**FALLBACK DOMAIN: `tii-id.org`, conditional on a trademark/confusion
clearance search (USPTO TESS, EUIPO eSearch, WIPO Global Brand Database,
UAE mark check — Nice classes 9, 35, 42, 45) completing without a blocking
or plausibly-confusing result.**

Neither is purchased by this task.

### 14.3 Registrar decision

Re-evaluated with the expanded criteria this phase requires (security,
predictable renewal pricing, transfer portability, DNS independence,
account-recovery quality, 2FA/hardware-key support, no unnecessary hosting
lock-in) — not cheapest-price-only:

| Registrar | Security / 2FA | Hardware-key (WebAuthn/FIDO2) support | Renewal pricing predictability | Transfer portability | DNS independence | Hosting lock-in |
|---|---|---|---|---|---|---|
| **Cloudflare Registrar** | Strong account 2FA (TOTP + WebAuthn) | **Yes** | At-cost, no markup — most predictable | Standard EPP auth-code, no add-on fee | Requires Cloudflare DNS (a real constraint, not a lock-in on hosting) | None — hosting-agnostic |
| **Porkbun** | TOTP 2FA | No | Stable historically, not contractually guaranteed | Standard EPP auth-code | Full — any DNS provider | None |
| **Namecheap** | TOTP 2FA | No | Renewal notably higher than promotional first year | Standard EPP auth-code | Full | None |
| **Gandi** | TOTP 2FA | No | Higher baseline, stable | Standard EPP auth-code | Full | None |
| Vercel Domains | Tied to Vercel account | No | Varies, resold | Adds an extra step (decouple from hosting account first) | Tied to Vercel by default | **Yes — rejected on this basis alone (§7/§8 of this document, unchanged)** |

**Recommendation: Cloudflare Registrar** — the only option in this
comparison offering hardware-key (WebAuthn/FIDO2) account protection, at-cost
pricing (removes the "surprise renewal" risk that at-cost eliminates by
definition), and full DNSSEC support, at the cost of a soft DNS
requirement (Cloudflare DNS) that does not constrain *hosting* in any way
(TII's hosting is already provider-agnostic — see §7). This is a security-
and-predictability choice, not a cheapest-price choice; Porkbun is the
documented fallback if Cloudflare's DNS requirement is later judged
undesirable.

**The registrar is replaceable infrastructure and is never part of TII
identity** — unchanged principle, §7/§8 above.

### 14.4 Domain authorization packet

```
Recommended domain:      transition-ignition-id.org
Registrar:                Cloudflare Registrar
Initial price:             ~$10.44/yr (at cost, .org, subject to re-quote at purchase)
Renewal price:              ~$10.44/yr (at cost, no markup)
DNSSEC:                    Supported, will be enabled at registration
Transfer support:           Standard EPP auth-code; ICANN 60-day post-registration lock applies
Brand/confusion finding:    Minimal exposure — no material collision identified
Reason for selection:       Names the scheme unambiguously; avoids the
                            Technology Innovation Institute ("TII", tii.ae)
                            collision that the tii-id.org candidate carries;
                            registrar offers at-cost pricing, DNSSEC, and
                            hardware-key account protection

ACTION REQUIRING HUMAN AUTHORIZATION:
REGISTER / DO NOT REGISTER
```

**Not registered. Awaiting explicit human authorization — REGISTER or DO
NOT REGISTER is not decided by this task.**

### 14.5 DNS plan (final, for the recommended domain, not deployed)

Unchanged in substance from §9 above; restated concretely for
`transition-ignition-id.org` specifically:

| Record | Plan |
|---|---|
| Apex (`transition-ignition-id.org`) | `A`/`AAAA` or `ALIAS`/`ANAME` to the then-current hosting target (Vercel today; portable) |
| `www` | `CNAME` to apex, with a 301 `www → apex` at the application layer |
| HTTPS | Required; HTTP 301s to HTTPS |
| DNSSEC | Signed zone at registration; DS record published at the registrar |
| `CAA` | `0 issue "letsencrypt.org"` (+ the active host's CA if different); `0 iodef "mailto:security@transition-ignition-id.org"` once role mail exists (§Governance) |
| Mail (`MX`/`SPF`/`DKIM`/`DMARC`) | **Not added now.** Added only once role email addresses are separately authorized (`spec/governance-finalization.md` §Role Emails) |
| Migration to another host | Repoint the apex record and `TII_RESOLVER_BASE_URL` stays unchanged (it already names the domain, not the host) — zero TII-side change |

**No DNS record is created by this task.** This plan activates only after
§14.4's REGISTER decision and a separate DNS-configuration authorization.

### 14.6 Resolver configuration — reconfirmed

- `TII_RESOLVER_BASE_URL` remains the single authoritative source
  (`src/server.js`, `src/export.js`) — unchanged, re-verified by code
  inspection this phase (no new resolver-base reference was added anywhere
  by the production-gate wiring in the prior phase).
- Identifier tokens contain no domain — unchanged (`src/identifier.js`
  `generateIdentifier()` takes no domain parameter).
- Moving hosts, changing registrar, or changing DNS provider each require
  zero TII code or identifier changes — one environment variable, set once
  the domain is approved and configured.

G7 remains **CONDITIONAL PASS** as of §14: the decision was fully frozen
(one recommended domain, one fallback, one recommended registrar, a
complete authorization packet, and a DNS plan) — everything that could be
prepared without an irreversible external action had been prepared. See
§15 for the registrar change and §16 for the completed registration and
G7's resolution to PASS.

## 15. Registrar decision superseded (2026-09-12)

The steward explicitly changed the approved registrar for
`transition-ignition-id.org` from **Cloudflare Registrar** (§14.3) to
**Vercel Registrar**, in writing, superseding decision H. Reasoning
recorded at the time: the existing, already-authenticated Vercel
account/team (`platoststems-projects`) already owns the live `tiiarchive`
project, making direct domain-to-project attachment immediate with no
separate DNS handoff step.

**Before switching, this document's §8 caution was already on record:**
"Do not register through Vercel even though it offers domains — it
couples the domain account to the hosting account and adds an unnecessary
transfer step." That reasoning was surfaced again at the moment of
decision (not silently dropped) and the steward chose convenience and
direct attachment over registrar/hosting independence — an explicit,
informed trade-off, not an oversight. §17 below records the honest,
resulting coupling.

A live price check via the Vercel CLI (`vercel domains price
transition-ignition-id.org`, run against the authenticated account, no
purchase) confirmed ordinary, non-premium `.org` pricing: **$8.49
purchase / $10.99 renewal / $17.99 transfer-out, 1-year term** — consistent
with, and slightly below, the representative pricing range in §3/§14.2.

## 16. Registration executed and independently verified (2026-09-12)

Purchase was executed by the steward directly through the Vercel CLI
(`vercel domains buy`), which — notably — **refused to run
non-interactively**: `"Agents must not purchase domains on behalf of a
user... The user must run this command interactively... to confirm price,
auto-renew, and provide registrant contact details."` This is Vercel's own
platform-level safeguard against agent-executed purchases; it was
respected, not routed around. The steward then completed the purchase
themselves and reported it done.

**That report was not taken on trust.** Independent verification performed
after the report, using two separate sources:

| Check | Method | Result |
|---|---|---|
| Registrar-side registration | `vercel domains inspect transition-ignition-id.org` (authenticated CLI, already-established session) | Registered via Vercel, expires 2027-09-12, nameservers `ns1`/`ns2.vercel-dns.com` matching intended, attached to project `tiiarchive` |
| Public registry confirmation | Live RDAP query (`rdap.publicinterestregistry.org`), independent of Vercel | `errorCode: null` (registered), registration event `2026-09-12T04:56:24Z`, nameservers matching Vercel's report exactly, status `client transfer prohibited` + `add period` (standard immediately-post-registration state) |

Both sources agree, independently. **Registration is confirmed.**

### DNS, HTTPS, and resolver configuration — verified live, not assumed

- **DNS resolves:** `https://transition-ignition-id.org` loads the live
  TII homepage.
- **HTTPS is valid:** the page loaded over `https:` with no certificate
  warning or navigation failure (a cert mismatch/expiry would have blocked
  the load outright).
- **`TII_RESOLVER_BASE_URL` is correctly set:** confirmed behaviorally,
  not by reading the env var directly (this checkout isn't linked to the
  Vercel project) — `GET /catalog.json` on **both**
  `https://transition-ignition-id.org` and the legacy
  `https://tiiarchive.vercel.app` report
  `"resolver_base": "https://transition-ignition-id.org"`, and both serve
  byte-identical content (`generated_at` timestamps match exactly) — this
  is one static build, deployed once, correctly configured with the new
  domain as its resolver base.
- **All required public routes verified live:** `/`, `/registry`, `/spec`,
  `/audit`, `/about`, `/catalog.json`, `/ja` all render correctly on the
  new domain. `/tii/tii_h4r3jsn4p25d` (the known test identifier) resolves
  with its full record; a syntactically-valid-but-unissued slug and a
  syntactically-invalid slug both correctly return the static site's "Not
  found" page (this deployment has no server-side routing to distinguish
  400 from 404, unchanged prior finding — both are inert, non-canonical
  outcomes either way). `GET /admin` also returns "Not found" — confirming,
  again, that the static export exposes no admin/write surface on the new
  domain.

### `tiiarchive.vercel.app` — confirmed still explicitly non-canonical

Still reachable (same project, second domain), still serves identical
content, and **its own self-reported `resolver_base` names the new domain,
not itself** — it does not claim to be canonical anywhere in its own
output. This is the correct "old address remains a working mirror, new
address is authoritative" pattern (§6 of `governance-candidate.md`),
achieved automatically because both domains point at the same single
Vercel project and the same single build.

### Identity invariants — reconfirmed empirically

- **No TII identifier contains the domain:** `grep -c
  "transition-ignition-id" data/ledger.jsonl` → `0`.
- **Canonical ledger byte-for-byte unchanged:** md5 `fb56b2a4a2f5fe134f3fa23e2186e7d1`,
  head hash `eb27a2b7a557465b1301e7225052d03b6fc1550caa7b9ea943e5e90835427e95`,
  event count `10` — identical before and after this entire registration
  process, confirmed by direct local inspection (`git status --porcelain`
  shows no change to `data/ledger.jsonl`).
- **All existing identifiers remain test-only:** the sole identifier,
  `tii:h4r3jsn4p25d`, still reports `identifier_status: "test"` on the live
  site and in the local ledger alike.
- **Production issuance remains DISABLED:** unaffected by any of the above
  — domain registration is an infrastructure change, not a gate-bypassing
  one; `TII_PRODUCTION_ISSUANCE_ENABLED` was not touched.

## 17. Honest note: registrar/hosting coupling now exists

Because the registrar was switched to Vercel specifically, `§8`'s original
caution is now a live, accepted fact rather than an avoided risk: the
domain account and the hosting account are the same account
(`platoststems-projects`). This does **not** affect TII identifier
identity (the invariants in §16 above hold regardless of who owns the
domain), but it does mean an eventual registrar-independent transfer would
now require an *extra* step (moving the domain out from under the same
account as hosting) that choosing Cloudflare would have avoided. Recorded
here plainly, not minimized — this was a known, named trade-off at the
time of decision (§15), not a surprise.

## 18. G7 status: PASS (2026-09-12)

Every G7 acceptance condition (`spec/production-launch-gate.md` §19) is
now independently verified true: domain registered (RDAP + Vercel, two
sources), DNS under intended control (nameservers match), HTTPS works,
stable resolver routes work, stable `/spec` URL exists, resolver
configuration uses the approved domain (verified via live `catalog.json`
on two hosts), Vercel remains non-canonical (self-reports the new domain,
not itself), identifier tokens remain domain-independent (zero
occurrences), hosting replacement remains conceptually possible (the
`TII_RESOLVER_BASE_URL` mechanism is unchanged — only registrar/hosting
account unification per §17 is new), and no production issuance was
enabled by any of this.

**G7 — Permanent resolver: PASS.**
