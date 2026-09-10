# TII Production Identifier Freeze Audit

Transition-Ignition Identifier · audit round: identifier + verification layer

> **Production issuance is DISABLED and remains disabled.** No production TII has
> been issued. No identifier's `identifier_status` has changed from `"test"`.
> `src/id.js`, ledger semantics, `src/canonical.js`, and issuance behaviour are
> unchanged. The only code added is `src/candidate/*` (not imported anywhere)
> plus its tests.
>
> **Revised after the first audit round** — three corrections, no other change:
> (1) UUIDv4 assessed as a legitimate RFC 9562 candidate, technical rationale
> only (§D); (2) RFC 3986 fragment handling — a fragment is a generic component,
> separated, not an invalid TII (§C companion spec §2.1, §6, §7); (3) signed
> checkpoint canonicalization is normatively **RFC 8785 JCS**, in a module
> separate from the ledger's hash-chain canonicalization (§E).

This document is reports **A–H** plus the decision table (§32), the theoretical
audit (§33) and the acceptance-condition answers (§34). The companion documents:

- [`identifier-syntax-1.0-candidate.md`](identifier-syntax-1.0-candidate.md) — the draft normative spec
- [`iana-provisional-registration.md`](iana-provisional-registration.md) — RFC 7595 registration draft
- [`succession-policy.md`](succession-policy.md) — TII Succession Policy (candidate)
- [`resolver-domain-decision.md`](resolver-domain-decision.md) — permanent-domain decision report (no purchase)
- [`test-vectors.json`](test-vectors.json) — machine-readable vectors (regenerate with `gen-test-vectors.js`)

---

## A. Decision report

### A.1 What is being frozen

The parts of TII that a first production identifier makes **permanently
load-bearing**: the URI scheme, the token construction, the canonical textual
form, the parse rules, the issuance procedure, the resolver/identifier split,
the withdrawal / invalid-issuance / non-reuse rules, the signing and
key-rotation model, specification versioning, and the succession policy.

The parts explicitly **not** frozen, and which must not become rigid: what a TII
refers to, its state, transitions, ignition, addresses, domain, boundary,
lineage, ownership, stewardship, or classification. Those remain appended,
revisable, contestable records (see §33).

### A.2 Recommendation summary

| Question | Recommendation |
|---|---|
| URI scheme | `tii:` — adopt, **and** file an IANA *provisional* registration (RFC 7595) before first production issuance. `tii` is currently unregistered (§C). |
| Token | 128-bit CSPRNG entropy, RFC 4648 Base32, unpadded, lowercase, **26 characters**. Candidate **A**. |
| Canonical form | `tii:` + 26 lowercase Base32 chars; scheme and token both lowercased; exactly one canonical string; strict parser, no character substitution. |
| Collision handling | Birthday risk is negligible at every realistic scale (§B); issuance still performs a local uniqueness check and discards a collided candidate before it is recorded. |
| Resolver | `https://<resolver-base>/tii/<token>`; resolver base is configuration; never in the identifier. |
| Verification | SHA-256 event chain (already shipped) + periodic **Ed25519**-signed checkpoints, published as plain files in independent locations. No blockchain. |
| Withdrawal / invalid issuance / transfer | Appended events only; the issuance event is never mutated; the identifier is never reused or deleted. |
| Spec versioning | `major.minor.patch` with **TII-specific** change classes (§21 below); interpretation-affecting changes are themselves recorded. |
| Permanent resolver domain | **UNDECIDED.** Report in `resolver-domain-decision.md`; no domain purchased or configured. |
| Migration of the current 12-char test IDs | Keep as historical **test** records; do not promote, do not reuse; production begins with freshly minted identifiers (§27). |
| Production switch | **Stays off** until the acceptance conditions in §34 are all answered without ambiguity and the audit is accepted. |

### A.3 Material-defect check on candidate A

Candidate A has **no disqualifying defect**. It has one canonicalization
subtlety that the spec must (and the reference implementation does) handle
explicitly:

> 128 bits over 26 Base32 symbols leaves the final symbol carrying only 3 data
> bits; its low 2 bits must be zero in canonical form (RFC 4648 §3.5). Valid
> final characters are therefore `{a, e, i, m, q, u, y, 4}` only. A conformant
> decoder **rejects** a 26-char token whose last character is anything else
> (`non-canonical-tail`). It does not "fix" it.

This is a well-understood property of Base32 of a 16-byte value, is fully
covered by test vectors, and is strictly better than the alternatives of
(a) silently accepting non-canonical tails, or (b) padding the token to a byte
boundary and carrying dead characters. It is reported here rather than hidden.

---

## B. Collision mathematics

Token entropy: **128 bits**, uniform, from `crypto.randomBytes(16)`.
Space size `N = 2^128 ≈ 3.4028 × 10^38`.

Birthday bound (probability that **any** two of `n` identifiers collide):

```
p(n) ≈ 1 − e^(−n(n−1) / 2N)  ≈  n² / (2N)   for small p
```

| Issued identifiers `n` | Approx. collision probability `p(n)` | In words |
|---|---|---|
| 10³ | 1.5 × 10⁻³³ | ~1 in 10³³ |
| 10⁶ | 1.5 × 10⁻²⁷ | ~1 in 10²⁷ |
| 10⁹ | 1.5 × 10⁻²¹ | ~1 in 10²¹ |
| 10¹² | 1.5 × 10⁻¹⁵ | ~1 in 10¹⁵ (a quadrillion) |

Reference points:

- **50 % collision chance** is not reached until `n ≈ 1.177 √N ≈ 2.2 × 10¹⁹`
  identifiers (twenty quintillion).
- To reach even a **one-in-a-billion** (10⁻⁹) cumulative collision chance you
  must issue `n ≈ √(2N·10⁻⁹) ≈ 8.3 × 10¹⁴` identifiers.
- DOI has registered on the order of 10⁹ identifiers over ~25 years. At that
  scale the TII collision probability is ~10⁻²¹.

**Interpretation.** At any issuance volume TII could plausibly reach in
centuries, a random 128-bit collision is far less likely than a simultaneous
independent hardware failure of every mirror, and is dominated by the risk of
operational error. 128 bits is sufficient; there is no demonstrated reason to
use more, and going wider only lengthens the token.

**Issuance still checks.** Probabilistic negligibility is not a licence to skip
the check. The candidate issuance procedure is:

```
loop:
  candidate ← "tii:" + base32(csprng(16))      # fail closed if CSPRNG unavailable
  canonicalise(candidate)
  if registry_contains(candidate): discard; continue     # NOT recorded
  break
append tii.issued(candidate)
```

A discarded candidate never enters the ledger — it was never a TII. A production
TII, once in a committed `tii.issued` event, is **never** reused for another
reference and **never** removed (see §13/§14 handling below).

---

## C. URI scheme / IANA analysis

### C.1 Live registry check (this audit)

The IANA *Uniform Resource Identifier (URI) Schemes* registry
(`https://www.iana.org/assignments/uri-schemes/`) was checked during this audit.

> **`tii` is not registered** — not Permanent, not Provisional, not Historical.
> Alphabetical neighbours present include `things` (provisional), `thismessage`
> (permanent), `thzp` (historical), `tip` (permanent, *Transaction Internet
> Protocol*), `tn3270`, `tool`. There is **no** `tii` and no `tii`-prefixed
> entry.

`tip:` is the closest name but is a different string and an unrelated protocol;
there is no collision. This check must be **repeated immediately before first
production issuance** — registry state can change.

### C.2 Registration strategy

Per RFC 7595, `tii` qualifies for **Provisional** registration now (a stable
public specification + a designated contact/change-controller are the main
requirements; the spec is drafted, governance is the open item). Permanent
status can follow later with expert review.

A full RFC 7595 registration template is drafted in
[`iana-provisional-registration.md`](iana-provisional-registration.md). It is
**not** to be submitted automatically. Contact and change-controller fields are
left `PROVISIONAL` and must not be hard-coded until TII governance is approved.

### C.3 Launch gate (restated, binding)

No production identifier using `tii:` may be issued until **all** of:

1. the identifier syntax is frozen (this spec accepted);
2. the public TII specification is stable enough to cite as the scheme's
   defining reference;
3. the current IANA registry has been re-checked for `tii`;
4. a decision has been recorded on filing the provisional URI-scheme
   registration (file / defer, with reasons).

### C.4 Why a scheme at all (vs. HTTPS-only)

DOI and ARK are, in practice, resolved as HTTPS URLs; DOI's `doi:` scheme is not
a permanently registered IANA scheme and DOIs are cited as `https://doi.org/…`.
`did:` (Decentralized Identifiers) *is* a permanent scheme and shows that an
identifier meant to outlive any particular resolver benefits from a
scheme-based, resolver-independent canonical form.

TII takes the `did:`-style position: the **identifier** is `tii:<token>` and is
not an HTTP URL; the **resolution URL** is a separate, replaceable access
mechanism. This is the single most important structural decision for
long-term stability (see §10 / §33).

---

## D. Identifier syntax comparison

Candidates evaluated (all with 128-bit CSPRNG entropy unless noted). All three
are legitimate standardized identifier formats; the comparison is technical.

- **A** — Base32 (RFC 4648), unpadded, lowercase, 26 chars. `tii:aaaqeayeaudaocajbifqydiob4`
- **B** — lowercase hex, 32 chars. `tii:000102030405060708090a0b0c0d0e0f`
- **C** — UUIDv4 textual form (RFC 9562), 36 chars, **122** random bits (4 version + 2 variant bits fixed). `tii:xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`

| Criterion | A · Base32/26 | B · hex/32 | C · UUIDv4/36 |
|---|---|---|---|
| Random entropy | 128 bits | 128 bits | 122 bits (6 bits fixed by RFC 9562) |
| Collision resistance | excellent (§B) | excellent (§B) | excellent (2⁶× smaller space; still negligible at any real scale) |
| Textual length | 26 | 32 | 36 (32 hex digits + 4 hyphens) |
| Alphabet | `a–z 2–7` | `0–9 a–f` | `0–9 a–f` + `-` |
| Transcription risk | low; alphabet omits `0 1 8 9` | low; `0`/`o`, `1`/`l` mistypes are possible but rejected, not repaired | low; same digit/letter mistypes possible; hyphen positions add a place to err |
| Parser work | one canonical form; the RFC 4648 zero-tail rule for a 16-byte value must be enforced (§A.3) | one canonical form; no special cases | canonical form is RFC 9562; requires case normalization, fixed hyphen positions, and version/variant-bit validation |
| Canonicalisation complexity | low (lowercase + zero-tail check) | lowest | moderate (case + hyphens + version/variant) |
| Standardisation | RFC 4648 | universal convention | RFC 9562 (strong, dedicated) |
| URI compatibility (RFC 3986) | token is all `unreserved` | all `unreserved` | `-` is `unreserved`; also fine |
| Filename compatibility | fine (all lowercase, no separators) | fine | fine (`-` is portable) |
| Database compatibility | `CHAR(26)` | `CHAR(32)`; indexes as hex | `CHAR(36)` or a native `UUID` column type where available |
| Version/variant structure | none | none | present, and unused by TII |
| Future portability | high | high | high |

### D.1 Recommendation: **A (Base32, 26 characters)**

UUIDv4 is a legitimate candidate. Candidate A is preferred on purely technical
grounds:

1. **Full 128 random bits.** A and B carry 128 random bits; UUIDv4 carries 122
   (RFC 9562 fixes 4 version + 2 variant bits). Not a practical collision
   concern, but for a value whose only job is to be a random reference there is
   no reason to spend 6 bits on structure.
2. **No unnecessary structure.** UUIDv4's version and variant fields are
   meaningful for UUID interoperability but carry no information TII needs, and a
   conformant parser must still validate them. A and B have nothing to validate
   beyond the alphabet (A: plus the zero-tail rule).
3. **Compactness.** 26 characters vs 32 (hex) vs 36 (UUID text: 32 hex digits +
   4 hyphens). Hyphens are pure textual overhead here. Shortness is the
   lowest-priority factor but favours A.
4. **Parsing.** A has one canonical form with one clearly specified rule (the
   RFC 4648 zero-tail constraint, enforced by rejection). B has none. UUIDv4's
   canonical text is well defined but requires case-folding, hyphen-position
   checks, and version/variant checks.
5. **Transcription.** A's alphabet omits `0 1 8 9`, removing the most common
   digit/letter confusions from inside a valid token. Invalid characters are
   rejected with a specific error, never substituted.

B (hex/32) is an acceptable fallback — simplest of all, at the cost of 6
characters — and the migration cost between A and B before any production
issuance is zero. C (UUIDv4) is viable but not preferred, for reasons 1–3.

---

## E. Signing design

### E.1 Problem

The shipped SHA-256 chain proves *internal consistency relative to a known
head*. It does not prove **who** attested to that head, and it cannot by itself
stop an attacker who replaces the whole file with a self-consistent forgery.

### E.2 Design (candidate, implemented in `src/candidate/checkpoint.js`)

```
ledger events ──SHA-256 chain──▶ ledger head hash
                                     │
              periodic ─────────────▶ checkpoint  { tii_checkpoint, ledger_head_hash,
                                     │              event_count, created_at, spec_version }
                                     │
             RFC 8785 JCS  (UTF-8)   ▼
                              Ed25519 signature  (RFC 8032, node:crypto)
                                     │
                    signed checkpoint file  { algorithm:"ed25519", key_id,
                                     │        public_key, checkpoint, signature }
                                     ▼
      published to multiple independent locations (git tag, archive, mirror, …)
```

- **Ed25519**, via `node:crypto` (`crypto.sign(null, …)` / `crypto.verify`).
  Standard, widely reviewed; no invented algorithm; no blockchain, token, or
  cryptoasset.
- **Signing input (normative):** the UTF-8 bytes of the **RFC 8785 JSON
  Canonicalization Scheme (JCS)** canonicalization of the checkpoint object.
  JCS gives property-order, whitespace, and representation independence, defines
  number serialization via ECMAScript `Number::toString`, and requires
  duplicate property names to be rejected. Never rendered HTML, never an
  unstable serialization. Implemented in `src/candidate/jcs.js` (canonicalize +
  a strict, duplicate-rejecting parser).
- **Separate from the ledger.** The historical ledger hash-chain uses
  `src/canonical.js` and is **not migrated or changed**. Checkpoint
  canonicalization (JCS) and ledger canonicalization are independent by design:
  the ledger format is frozen by every existing hash; the checkpoint format is
  new and adopts the cross-implementation standard.
- A checkpoint minimally binds: ledger head hash, event count / sequence
  position, checkpoint creation time, and the specification version /
  interpretation reference where appropriate.
- The signing key's identity (`key_id` = first 16 hex of SHA-256 over the SPKI
  DER) is **metadata in the checkpoint file, never in the TII token**.

### E.3 Key management (candidate — conceptual model, `not_before` / `not_after` / `revoked_at`)

`src/candidate/checkpoint.js` verifies against an optional **keyset**:

```jsonc
[ { "key_id": "…", "public_key_pem": "…",
    "not_before": "2026-01-01T00:00:00Z", "not_after": "2026-06-30T23:59:59Z" },
  { "key_id": "…", "public_key_pem": "…", "not_before": "2026-07-01T00:00:00Z" } ]
```

- **Current signing key**, **rotation**, **compromised-key declaration**
  (`revoked_at`), **historical verification**, **transfer of signing
  responsibility**, and **multiple future signing authorities** are all
  expressible by appending keyset entries.
- A rotation **does not invalidate old signatures**: verification resolves the
  key by `key_id` and checks that the checkpoint's `created_at` falls inside
  *that key's* validity window. A checkpoint signed by an old key but dated
  after its window (a back-dating forgery attempt) is rejected
  (`checkpoint-after-key-validity`); a checkpoint dated after a key's
  `revoked_at` is rejected (`key-revoked-before-checkpoint`); genuine
  pre-compromise checkpoints stay valid.
- No requirement that one human or one institution hold the same private key
  forever. The keyset is itself portable data.

### E.4 Portability of signed checkpoints

`serialize()` writes plain UTF-8 JSON (pretty-printing allowed — it is not the
signing input). `deserialize()` is the strict JCS parser, which **rejects
duplicate property names** before anything is verified. A signed checkpoint
verifies with **only the file** (it embeds its `public_key`), or against a
keyset file. The signing input is RFC 8785 JCS of the `checkpoint` object, so a
second implementation reproduces it from the standard alone — no shared code,
no Vercel, no production database, no proprietary API, no original UI, no
original host. Tests prove: property-order independence, whitespace
independence, Unicode/numeric round-trips, file-only verification, duplicate-key
rejection, and rejection of a one-byte corruption. The RFC 8785 Appendix B
example is a conformance test (`test/candidate-jcs.test.js`).

### E.5 External witnesses (optional, never foundational)

Git tags/releases, archival repositories (Zenodo/Software Heritage), RFC 3161
timestamp authorities, institutional mirrors, and independent TII mirrors may
each hold copies of signed checkpoints. The system must remain reconstructable
and verifiable if **every** witness disappears, using only an exported ledger +
keyset. Blockchain is not required and is not used.

---

## F. Stewardship transfer & succession (summary)

Full policy: [`succession-policy.md`](succession-policy.md). Key points:

- **Identifier continuity ≠ operator continuity.** A TII survives a change of
  steward, operator, host, domain, database, or maintainers.
- Stewardship transfer is an **appended event** recording previous steward, new
  steward, effective time, evidence, authorization/signature, and any
  contestation. The steward is a **relation**, never encoded in the token; a
  change of steward never mints a new TII.
- Invalid issuance and withdrawal are appended events; the `tii.issued` event is
  never mutated; the identifier is never reassigned or deleted.
- The Succession Policy distinguishes *identifier persistence* from *availability
  of a particular resolver* from *continued institutional operation*, and makes
  **no** claim of metaphysical or absolute permanence.

---

## G. Security & privacy analysis

Full text is folded into the candidate spec (§"Security considerations" and
§"Privacy considerations"). Threats covered, with the TII response:

| Threat | Response |
|---|---|
| Identifier spoofing / look-alike tokens | Strict canonical form; no character substitution; resolvers display the full canonical `tii:` string; a valid token proves nothing about content. |
| Homoglyph / `0`↔`O`, `1`↔`l` | Alphabet excludes `0 1 8 9`; non-alphabet characters are a hard parse error, never repaired. |
| Malicious resolver redirect / domain compromise | Identifier is resolver-independent; multiple resolvers/mirrors; signed checkpoints let a client verify a ledger head obtained from any source; users can be shown which resolver they are on. |
| Ledger tampering (rewrite / delete / reorder) | SHA-256 chain (shipped) + signed checkpoints (candidate). |
| Signing-key compromise | Keyset `revoked_at`; multi-location publication; historical checkpoints verified against the key valid at their creation time. |
| Replay of an old signed checkpoint | Checkpoints carry `event_count` / head hash / `created_at`; a stale checkpoint is detectable as behind the current head and is not "the" head. |
| False translation | Localization is an appended, attributable event distinguishable as `literal` vs `interpretive`; the authored content is always retrievable (see main SPEC §7.1). |
| False provenance / stewardship assertion | Recorded as contestable relations/events; the resolver shows disputes; a valid TII does not imply a true assertion. |
| Unauthorized issuance | Issuance authority is a governance/keyset matter; globally-random tokens mean an unauthorized issuer cannot forge *someone else's* identifier, only mint its own (which the ledger and checkpoints attribute). |
| Denial of service | Static export + multiple mirrors + full offline reconstruction from an exported ledger. |
| Identifier enumeration | 128-bit random tokens are not enumerable; there is no sequential space to scan. |
| Privacy leakage via public metadata | See privacy model below; do not put sensitive data in events expecting it to be private. |
| Malicious external URLs in event content | Resolver treats all event content as **data**, never instructions; external links are shown, not auto-followed; `rel="noopener nofollow"`. |
| HTML/script injection via event content | All event content is HTML-escaped on render (shipped: `views.esc`); the resolver never executes content. |

**Normative statement (already in main SPEC, reinforced here):** a valid TII
does not imply valid, safe, true, authentic, scholarly, or approved content, and
a resolver must not automatically execute or trust content because it is
associated with a valid TII.

### G.1 Privacy model (model only — not implemented in this round)

Separate **the existence of an append-only canonical record** from **public
disclosure of every field**. A future mechanism:

- An event may carry a `disclosure` classification (`public` default;
  `restricted`; `embargoed-until`).
- For restricted/embargoed payloads, the canonical ledger stores a **commitment**
  (e.g. a salted hash of the protected content) plus non-sensitive metadata; the
  protected payload is held out-of-band and released (or not) later.
- Redaction is itself an **appended event** ("field X of event Y restricted on
  date Z, reason class R, commitment H") — never a deletion. Auditors can prove
  *that* a restriction occurred and later verify the released payload against the
  commitment.
- Personal data, security-sensitive addresses, and embargoed material use this
  path. **Privacy is never achieved by deleting historical events.**

This round delivers the model; implementation is deferred.

---

## H. Final recommended immutable profile

If the audit is accepted, these values become normative for
`TII Identifier Syntax and Resolution Specification 1.0` and MUST NOT change in
a way that alters any already-issued identifier:

```
name                Transition-Ignition Identifier
abbrev              TII
uri scheme          tii              (lowercase canonical; case-insensitive per RFC 3986)
canonical form      tii:<token>
token               128-bit CSPRNG entropy, RFC 4648 Base32, unpadded, lowercase, 26 chars
alphabet            a b c d e f g h i j k l m n o p q r s t u v w x y z 2 3 4 5 6 7
final char          one of  a e i m q u y 4   (RFC 4648 zero-tail rule)
padding             none ("=" is a parse error)
whitespace/unicode  parse error
percent-encoding    parse error
path/query/fragment parse error
case                stored & emitted lowercase; uppercase Base32 input accepted, normalised; no other folding
generation          crypto.randomBytes(16); fail closed; never a non-CSPRNG source
issuance            generate → canonicalise → registry uniqueness check → discard-and-retry on hit → append tii.issued
non-reuse           a committed production tii.issued token is never reused or deleted
resolver            https://<resolver-base>/tii/<token>  — base is config, not part of the identifier
verification        SHA-256 event chain (unchanged) + periodic Ed25519-signed checkpoints; signing input = RFC 8785 JCS of the checkpoint JSON; file-portable
key model           keyset with not_before / not_after / revoked_at; rotation never invalidates prior signatures
withdrawal          appended event; tombstone-style resolution; never a 404, never a mutation
invalid issuance    appended "issuance considered invalid" event; issuance event untouched; identifier not reassigned
stewardship         appended transfer event; steward is a relation, never in the token
spec versioning     major.minor.patch with TII change classes; interpretation changes are themselves recorded
succession          see succession-policy.md; identifier persistence ≠ resolver availability ≠ institutional operation
permanent domain    UNDECIDED — not selected, not purchased (resolver-domain-decision.md)
IANA                provisional registration drafted, NOT submitted; re-check registry before launch
production issuance DISABLED
```

---

## §32. Final decision table

| Item | Value | Status |
|---|---|---|
| Official name | Transition-Ignition Identifier | fixed |
| Abbreviation | TII | fixed |
| URI scheme | `tii:` | **candidate**; provisional IANA registration drafted, not submitted |
| Canonical form | `tii:<token>` (lowercase) | **candidate** |
| Entropy | 128 bits, CSPRNG (`crypto.randomBytes(16)`), fail-closed | **candidate** |
| Encoding | RFC 4648 Base32, unpadded, lowercase | **candidate** |
| Length | 26 characters | **candidate** |
| Case rule | lowercase canonical; uppercase Base32 input normalised; no other folding | **candidate** |
| Collision procedure | negligible birthday risk + mandatory local uniqueness check; discard collided candidate pre-record; never reuse | **candidate** |
| Resolver model | `https://<resolver-base>/tii/<token>`; base is configuration | **candidate** |
| Permanent domain | — | **UNDECIDED** unless separately approved |
| Signature mechanism | Ed25519 (`node:crypto`); signing input = RFC 8785 JCS of the checkpoint | **candidate** |
| Key-rotation model | keyset with `not_before` / `not_after` / `revoked_at`; historical signatures stay valid | **candidate** |
| Withdrawal model | appended event; tombstone resolution; no deletion, no 404, no mutation | **candidate** |
| Transfer model | appended stewardship-transfer event; steward is a relation | **candidate** |
| Specification version model | `major.minor.patch` + TII change classes; interpretation changes recorded | **candidate** |
| Succession policy | `succession-policy.md` | **candidate** |
| IANA registration status | draft prepared (RFC 7595) | **not submitted** |
| Production issuance | — | **MUST REMAIN DISABLED** |

---

## §33. Final theoretical audit

Does the permanent identifier layer reintroduce anything TII rejects?

| Concept | Reintroduced? | Why not |
|---|---|---|
| Essential identity | No | The token is 16 random bytes. It asserts only "tracking started from this reference point". It carries no essence and guarantees no sameness of the referent over time. |
| Immutable ownership | No | There is no `owner` in the token or the core. Ownership, if described at all, is derived locally from contestable relation events. |
| Immutable institutional authority | No | Issuer and steward are recorded as relations/events. Globally-random 128-bit tokens permit independent future issuers with **no** issuer prefix (§23). The signing keyset is transferable and multi-authority. P/A Institute is not encoded anywhere durable. |
| Fixed address | No | Addresses are appended module records; multiple simultaneous addresses; none privileged; the resolver URL is explicitly *not* the identifier. |
| Fixed domain | No | `domain` is an optional, revisable module, distinct from address. |
| Fixed state | No | No state field in the token or core; `state` is optional and re-describable. |
| Mandatory transition | No | `transition` is optional; "classifying this as a transition was wrong" is a recordable correction. The name "Transition-Ignition Identifier" is a label, not a claim that every TII has a transition. |
| Mandatory ignition | No | `ignition` is optional and not reduced to a boolean. |
| Permanent classification | No | Classifications are appended judgements, contestable and withdrawable. |
| Permanent lineage | No | `series` / lineage is a judgement *between* records, never a recorded object, never in the token. |

**Durability of the reference string is not metaphysical permanence of the
referenced configuration.** The 26-character token is designed to survive every
operational catastrophe (§34) unchanged; everything it points at remains
historically traceable and revisable.

---

## §34. Acceptance conditions — answered

| Question | Answer |
|---|---|
| What exact byte sequence generates a TII? | 16 bytes from `crypto.randomBytes(16)` (platform CSPRNG). No timestamps, sequence numbers, titles, authors, metadata hashes, file hashes, user IDs, or hostnames are ever mixed in. If the CSPRNG is unavailable, generation throws and no identifier is produced. |
| What exact characters may appear? | In the token: `a–z` and `2–7` only, exactly 26 of them, with the final character restricted to `{a e i m q u y 4}`. In the identifier: the literal `tii:` prefix then the token. Nothing else — no `=`, no whitespace, no `/ ? #`, no `%`, no non-ASCII. |
| What exact textual form is canonical? | `tii:` (lowercase) + the 26-char lowercase Base32 token. Exactly one canonical string per identifier. Uppercase Base32 input and an uppercase scheme are accepted and normalised on parse; every other deviation is a parse error with a stable code. |
| How is collision probability bounded? | Birthday bound `≈ n²/2^129`: ~10⁻¹⁵ at 10¹² identifiers, 50 % only near 2×10¹⁹. See §B. |
| What happens if a collision occurs? | During issuance the candidate fails the local uniqueness check, is **discarded before being recorded**, and a new candidate is drawn. It was never a TII. A committed production token is never reused. |
| What happens if the resolver domain disappears? | Nothing happens to any identifier. A new resolver is stood up at a different domain from an exported ledger; `TII_RESOLVER_BASE_URL` (or its successor) is repointed. The token is unchanged because the domain was never in it. |
| What happens if the operator disappears? | The Succession Policy applies: read-only archival continuation and/or community reconstruction from exported ledger + signed checkpoints + keyset. Identifier persistence is independent of institutional operation. |
| What happens if a signing key is compromised? | A `revoked_at` keyset entry is published; checkpoints dated after revocation are rejected; pre-compromise checkpoints remain verifiable against the key valid at their creation time; a new key is rotated in. No identifier changes. |
| What happens if an identifier was issued by mistake? | An "issuance considered invalid" event is **appended**. The `tii.issued` event is not mutated. The identifier is not reassigned and not deleted. The resolver explains the status. The vocabulary for "invalid" stays revisable and adds no universal ontological state to the core. |
| What happens if a record is withdrawn? | An appended withdrawal event; the resolver returns a tombstone-style status explaining the withdrawal, **not** a 404; unknown and invalid identifiers remain distinguishable from withdrawn ones. |
| What happens if stewardship transfers? | An appended stewardship-transfer event (previous steward, new steward, effective time, evidence, authorization, contestation). No new TII is minted. |
| What happens if TII Specification 2.0 rejects concepts used in 1.0? | Previously issued identifiers remain valid and unchanged. The interpretation change is itself a recorded, inspectable event; 1.0-era records keep their 1.0 interpretation context. A spec revision never silently rewrites the historical meaning of past records (main SPEC §7.1). |
| Can another implementation reconstruct and verify the system without the original cloud provider? | Yes. Export = the JSONL ledger + signed checkpoint files + keyset file, all plain UTF-8. A second implementation rebuilds derived state, re-verifies the SHA-256 event chain (ledger canonicalization) and re-verifies the Ed25519 checkpoint signatures (RFC 8785 JCS of each `checkpoint` object) with zero dependency on Vercel, the production DB, any proprietary API, or the original UI, and with no shared code — JCS is a published standard. Tests demonstrate file-only verification and RFC 8785 conformance. |
| Can every previously issued production TII remain unchanged through all of those events? | Yes. In none of the above does any answer require changing an already-issued identifier string. If a future proposal ever did, that proposal is rejected as a failed freeze. |

---

## §26 / §27. Test-identifier separation & migration decision

- **`identifier_status: "test"` metadata is sufficient** to separate current
  experimental identifiers from future production ones. "test" is **not** added
  to the permanent token — doing so would put semantic metadata in an opaque
  reference and create a parallel syntax. The resolver already marks
  experimental identifiers **`TEST IDENTIFIER`** visibly.
- **Migration of the existing 12-character test identifiers:** they were created
  under provisional rules (Crockford-ish alphabet, 12 chars, lenient decode).
  - Retain them as historical **test** records in the ledger. They are real,
    hash-chained, append-only records — of test activity.
  - **Do not** reinterpret, promote, or reuse them. `tii:h4r3jsn4p25d` (12
    chars, not Base32-26) is not a valid production identifier under this
    profile and will never be one.
  - **Production launch begins with entirely newly minted 26-character
    identifiers**, after the syntax freeze. Preferred default (§26) = yes.
  - No technical or theoretical defect in this approach: the ledger already
    distinguishes the identifiers by literal string and by `identifier_status`;
    the parser for the production profile simply does not accept the old form.
