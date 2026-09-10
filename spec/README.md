# spec/ — Production Identifier Freeze Audit + Governance Preparation

Documents for freezing the **permanent** identifier layer of TII, and for
preparing the resolver domain, governance identity, and IANA registration —
**before** the first production identifier is ever issued.

> Production issuance is **disabled**. Every issued identifier is
> `identifier_status: "test"`. Nothing in this directory or in `src/candidate/`
> changes that. No domain was purchased, no DNS changed, no email created, no
> IANA submission made, no governance identity finalized.

| File | Purpose |
|---|---|
| [`freeze-audit.md`](freeze-audit.md) | Decision reports A–H, collision math, IANA analysis, syntax comparison, signing design, security/privacy, the §32 decision table, the §33 theoretical audit, the §34 acceptance-condition answers, and the test-identifier migration decision. |
| [`identifier-syntax-1.0-candidate.md`](identifier-syntax-1.0-candidate.md) | Draft normative spec: terminology, ABNF, generation, encoding, case, canonicalization, validation, issuance, resolution, withdrawal, invalid issuance, non-reuse, stewardship, signing, key rotation, versioning, succession, security, privacy, test identifiers, examples, interoperability, IANA. **Not final.** |
| [`resolver-domain-decision.md`](resolver-domain-decision.md) | Permanent-domain evaluation: RDAP availability (2026-09-11), pricing/registrar/DNSSEC/transfer, brand-collision audit, URL structure, DNS plan, HTTPS behaviour, decision table, PRIMARY + FALLBACK recommendation. **No domain selected or purchased.** |
| [`governance-candidate.md`](governance-candidate.md) | Steward / change-controller / IANA-contact / role-email model; official-vs-mirror resolver distinction; public About/Governance copy; theoretical regression audit; final governance decision table. **All candidate.** |
| [`domain-failure-and-recovery.md`](domain-failure-and-recovery.md) | Succession audited against permanent-domain failure: expiry, registrar loss, DNS loss, operator dissolution, steward transfer, resolver move; emergency migration mechanism; the recovery kit. |
| [`iana-provisional-registration.md`](iana-provisional-registration.md) | RFC 7595 provisional URI-scheme registration — near-submission-ready draft; technical fields ready, governance fields marked unresolved. **NOT SUBMITTED.** |
| [`succession-policy.md`](succession-policy.md) | TII Succession Policy (candidate). |
| [`test-vectors.json`](test-vectors.json) | Machine-readable identifier test vectors, incl. RFC 3986 `uri_references` (fragment handling). Regenerate: `node spec/gen-test-vectors.js`. |
| [`gen-test-vectors.js`](gen-test-vectors.js) | Vector generator (uses `src/candidate/identifier.js`). |
| [`capability-boundary-audit.md`](capability-boundary-audit.md) | **Empirical audit of what the implementation actually does today** — capability matrix, known failures + blocker classification, evidence-cited scorecard, the four "can / candidate / spec-only / must-not-claim" lists, and the final questions answered. 34 capabilities: 24 PASS, 5 PARTIAL, 2 FAIL, 1 NOT IMPLEMENTED, 2 CANDIDATE ONLY. |
| [`capability-matrix.json`](capability-matrix.json) | Machine-readable matrix; every PASS backed by an executed test. |
| [`performance-results.json`](performance-results.json) | §30/§31 large-payload + scale measurements (100 / 1,000 / 10,000 TIIs). |
| [`security-test-results.md`](security-test-results.md) | §21 input-security — 22 code-shaped payloads × every output surface. Verdict: no execution/structural-corruption path. |
| [`audit/`](audit/) | The audit harnesses (`*-audit.js`, `demonstration.js`) + their raw run outputs. Isolated temp ledgers only; `data/ledger.jsonl` is never touched. |

The audit's reproducible subset runs under `node --test`
(`test/capability-regression.test.js`). It documents the boundary including the
known negatives (§26 full-chain forgery undetectable by `verify()` alone; §27
crash; §40 no privacy).

Reference implementation of the candidate profile: `src/candidate/`
(not imported by the running system):
`identifier.js` (`parseCanonicalTII` / `parseTIIReference` — RFC 3986 fragment
handling), `jcs.js` (RFC 8785 JSON Canonicalization Scheme), `checkpoint.js`
(Ed25519 signing over JCS). Tests: `test/candidate-identifier.test.js`,
`test/candidate-jcs.test.js`, `test/candidate-checkpoint.test.js`.

### Corrections applied after the first audit round

1. **UUIDv4** is treated as a legitimate RFC 9562 candidate; Candidate A is
   preferred on purely technical grounds (122 vs 128 random bits, longer text,
   hyphen overhead, unused version/variant structure, compactness). No
   aesthetic/philosophical rejection rationale.
2. **RFC 3986 fragments** — `tii:<token>#x` is a URI reference, not an invalid
   TII. The fragment is separated before scheme-specific processing, removed
   before resolution, does not affect registry lookup, and has no TII semantics.
   `parseCanonicalTII` is strict; `parseTIIReference` separates the fragment.
3. **Signed checkpoint canonicalization** — normatively **RFC 8785 (JCS)**,
   implemented in `src/candidate/jcs.js`. Separate from the historical ledger
   hash-chain canonicalization (`src/canonical.js`), which is unchanged.
