# Permanent Resolver Domain — Decision Report

> **No domain has been selected, purchased, or configured.** This report exists
> so the decision is made deliberately, later, and separately. The current
> deployment host `tiiarchive.vercel.app` is an endpoint only and MUST NOT be
> treated as the permanent resolver identity or written into any production
> identifier or identity metadata.

## 1. Why this is decoupled from the identifier freeze

Because the identifier is resolver-independent (`identifier-syntax-1.0-candidate.md`
§9), the domain choice is **reversible forever**: it can be chosen after first
production issuance, and changed again later, with zero effect on any identifier.
It should therefore not gate the freeze — but it also should not be chosen
casually just because a name is cheap or currently free.

## 2. Evaluation criteria (no candidate names asserted here)

| Criterion | What "good" looks like |
|---|---|
| Institutional neutrality | Not tied to one company, product, or person; readable as shared infrastructure. |
| Independence from Vercel / any host | Not a subdomain of a hosting provider; portable A/AAAA/CNAME. |
| Independence from a theory version | Not `ziran-*`, not versioned; survives upstream-theory revisions. |
| Independence from P/A Institute naming | Prefer a name that reads as "the TII resolver", not "P/A's site", so stewardship can transfer without the domain looking wrong. |
| Spelling stability | One obvious spelling; no easily-mistyped homophones; no hyphens if avoidable. |
| International readability | Pronounceable and typable across major keyboard layouts; ASCII; no IDN. |
| TLD longevity & policy | A TLD with stable, non-speculative registry policy and a low chance of future restriction or price shock. |
| Renewal cost & multi-year registration | Register for the maximum allowed term; predictable renewal. |
| Registrar portability | No registrar lock-in; standard auth-code transfer; ideally a registrar that supports registrar-lock and 2FA. |
| DNSSEC support | Registrar and TLD both support DNSSEC; plan to sign the zone. |
| Trademark conflict risk | Clear search for conflicting marks in relevant classes before purchase. |
| Conceptual obsolescence risk | Avoid encoding a claim that could age badly (e.g. "permanent", "official", a year, an institution). |

## 3. Operational requirements once chosen

- Register for the maximum term; enable auto-renew **and** calendar reminders
  held by more than one person.
- Enable registrar lock, 2FA, and DNSSEC.
- Keep the zone portable: short, standard records; no host-proprietary DNS
  features on the apex.
- Document the domain, registrar, and renewal in the succession kit
  (`succession-policy.md` §1) so a successor steward can take it over.
- The resolver base is still read from configuration
  (`TII_RESOLVER_BASE_URL`); the domain is data, not code.

## 4. Decision

**Deferred.** To be made in a dedicated step with explicit instruction to
purchase/configure. Until then:

- production issuance stays disabled;
- the specification's examples use placeholder hosts
  (`resolver.example`, `<resolver-base>`);
- no production identifier or identity record contains any hostname.
