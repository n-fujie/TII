# spec/ — Production Identifier Freeze Audit

Documents for freezing the **permanent** identifier layer of TII **before** the
first production identifier is ever issued.

> Production issuance is **disabled**. Every issued identifier is
> `identifier_status: "test"`. Nothing in this directory or in `src/candidate/`
> changes that.

| File | Purpose |
|---|---|
| [`freeze-audit.md`](freeze-audit.md) | Decision reports A–H, collision math, IANA analysis, syntax comparison, signing design, security/privacy, the §32 decision table, the §33 theoretical audit, the §34 acceptance-condition answers, and the test-identifier migration decision. |
| [`identifier-syntax-1.0-candidate.md`](identifier-syntax-1.0-candidate.md) | Draft normative spec: terminology, ABNF, generation, encoding, case, canonicalization, validation, issuance, resolution, withdrawal, invalid issuance, non-reuse, stewardship, signing, key rotation, versioning, succession, security, privacy, test identifiers, examples, interoperability, IANA. **Not final.** |
| [`iana-provisional-registration.md`](iana-provisional-registration.md) | RFC 7595 provisional URI-scheme registration template. **Draft — not for submission.** |
| [`succession-policy.md`](succession-policy.md) | TII Succession Policy (candidate). |
| [`resolver-domain-decision.md`](resolver-domain-decision.md) | Permanent-domain evaluation. **No domain selected or purchased.** |
| [`test-vectors.json`](test-vectors.json) | Machine-readable identifier test vectors. Regenerate: `node spec/gen-test-vectors.js`. |
| [`gen-test-vectors.js`](gen-test-vectors.js) | Vector generator (uses `src/candidate/identifier.js`). |

Reference implementation of the candidate profile: `src/candidate/`
(not imported by the running system). Tests:
`test/candidate-identifier.test.js`, `test/candidate-checkpoint.test.js`.
