# TII Identifier Syntax and Resolution Specification — 1.0 **Candidate**

Transition-Ignition Identifier (TII) · 遷移発火識別子

> **Status: 1.0 CANDIDATE — not final.** This document is produced for the
> production-identifier freeze audit ([`freeze-audit.md`](freeze-audit.md)). It
> is not final until that audit is accepted. **Production issuance is disabled.**
> No production TII has been issued; every issued identifier is
> `identifier_status: "test"`. The reference implementation of this candidate
> profile is `src/candidate/identifier.js` and is **not wired into issuance**.

The general TII data model, append-only semantics, optional modules, localization
model, evidence/judgement/display separation, and "no display-driven mutation"
invariant are specified in the repository's `SPEC.md` and are unchanged. This
document specifies only the **permanent identifier layer**: syntax, generation,
canonicalization, validation, issuance, resolution, lifecycle, verification,
versioning, and succession.

---

## 1. Terminology

- **TII** — the identifier: the string `tii:<token>`.
- **token** — the opaque 26-character reference value.
- **entropy** — the 128 random bits the token encodes.
- **canonical form** — the single permitted textual representation of a TII.
- **resolver** — a service that returns records for a token over HTTP(S).
- **resolution URL** — `https://<resolver-base>/tii/<token>`; an access
  mechanism, **not** the identifier.
- **issuance** — appending a `tii.issued` event for a token to the canonical
  ledger.
- **steward** — the party currently responsible for maintaining a TII's records;
  recorded as a relation, never encoded in the token.
- **checkpoint** — a signed statement binding a ledger head hash at a point in
  time (§17).
- **MUST / SHOULD / MAY** — as in RFC 2119 / RFC 8174.

## 2. Identifier syntax (ABNF)

Per RFC 5234. Compatible with RFC 3986. A **canonical TII** has no authority,
path, or query; a `#fragment` is a generic RFC 3986 component and is **not part
of the identifier** (§2.1).

```abnf
tii              = scheme ":" tii-token       ; the canonical identifier
scheme           = %s"tii"       ; lowercase in canonical form;
                                 ; RFC 3986 §3.1 makes it case-insensitive on input
tii-token        = 25(base32-char) base32-final
base32-char      = %x61-7A / "2" / "3" / "4" / "5" / "6" / "7"   ; a-z 2-7 (canonical: lowercase)
base32-final     = "a" / "e" / "i" / "m" / "q" / "u" / "y" / "4"
                                 ; RFC 4648 §3.5 zero-tail rule for a 16-byte value

tii-reference    = tii [ "#" fragment ]       ; an RFC 3986 URI reference to a TII
fragment         = *( pchar / "/" / "?" )     ; RFC 3986 §3.5, verbatim; not interpreted by TII
```

On input the token MAY additionally use `A-Z` (equivalently `%x41-5A`) for the
Base32 letters; a parser normalizes them to lowercase (§7). No other input form
is accepted.

Total length of a canonical TII: `4 + 26 = 30` characters.

### 2.1 Fragments (RFC 3986)

A reference of the form `tii:<token>#<fragment>` is a valid **URI reference**.
The fragment:

- is governed by RFC 3986 §3.5, not by TII;
- is separated **before** any TII scheme-specific processing — everything from
  the first `#` to the end of the string is the fragment;
- is **removed before resolution** and does **not** affect registry lookup;
- carries **no TII-specific semantics** — TII assigns none, and an
  implementation MUST NOT invent any.

The *canonical TII* underlying `tii:<token>#x` is `tii:<token>`. A strict parser
for the canonical form (`parseCanonicalTII`) reports `has-fragment` for a
fragmented input — it is a URI reference, not a canonical TII — while a
reference parser (`parseTIIReference`) returns the underlying `tii` and the
separated `fragment`. Canonicalization (§6) drops the fragment.

## 3. Generation algorithm

```
1. entropy ← CSPRNG(16 bytes)         # Node: crypto.randomBytes(16)
   - if secure randomness is unavailable, ABORT. Do not substitute any
     non-cryptographic source. No Math.random. No PRNG. No time-seeded source.
2. token   ← base32_rfc4648(entropy)  # unpadded, then lower-cased -> 26 chars
3. id      ← "tii:" + token
```

The token MUST NOT be derived from, or mixed with: timestamps, sequential or
database identifiers, titles, authors, metadata hashes, file content hashes,
user identifiers, hostnames, or any other value. The token is a function of the
16 CSPRNG bytes and nothing else.

**Entropy requirement:** at least 128 bits. This audit found no reason to exceed
128 (see `freeze-audit.md` §B). A future spec version MAY define a longer token
*for new identifiers* without affecting existing ones.

## 4. Encoding (RFC 4648 Base32)

- Alphabet (canonical, lowercase): `abcdefghijklmnopqrstuvwxyz234567`.
- 16 bytes → 26 symbols. No `=` padding is emitted or accepted.
- Because 128 is not a multiple of 5, the 26th symbol carries 3 data bits and
  2 zero bits. Its canonical value is therefore one of
  `{a, e, i, m, q, u, y, 4}` (alphabet indices 0, 4, 8, 12, 16, 20, 24, 28).
- A decoder MUST reject a 26-symbol token whose trailing 2 bits are non-zero
  (error `non-canonical-tail`). It MUST NOT mask, truncate, or "repair" them.

### 4.1 Test vectors (normative subset; full set in `test-vectors.json`)

| 16 bytes (hex) | token |
|---|---|
| `00000000000000000000000000000000` | `aaaaaaaaaaaaaaaaaaaaaaaaaa` |
| `ffffffffffffffffffffffffffffffff` | `77777777777777777777777774` |
| `000102030405060708090a0b0c0d0e0f` | `aaaqeayeaudaocajbifqydiob4` |
| `deadbeefdeadbeefdeadbeefdeadbeef` | `32w35366vw7o7xvnx3x55ln654` |

Every encoder/decoder MUST round-trip the exact 128 underlying bits for these
and for arbitrary 16-byte inputs.

## 5. Case handling

- The scheme is emitted lowercase (`tii:`). Per RFC 3986 §3.1 it is
  case-insensitive on input; `TII:`, `Tii:` etc. normalize to `tii:`.
- The token is stored and emitted lowercase. Uppercase ASCII Base32 letters on
  input are normalized to lowercase.
- **No locale-sensitive case conversion** (use ASCII-only lowercasing).
- **No Unicode** anywhere in a TII. No Unicode normalization is applied or
  needed (there is nothing to normalize).
- No character is ever substituted for another: `0`→`o`, `1`→`i`, `1`→`l`,
  `8`→`b`, etc. are **not** performed. Such characters are outside the alphabet
  and produce error `bad-char`.

## 6. Canonicalization

There is exactly one canonical textual representation of any valid TII:
`tii:` + 26 lowercase Base32 characters.

A canonicalizer takes any acceptable reference form and returns the canonical
identifier, or throws:

1. if a `#` is present, separate the fragment (RFC 3986 §3.5: from the first
   `#` to the end) and set it aside — it is **not** part of the identifier;
2. reject any remaining input containing whitespace (`whitespace`), `%`
   (`percent-encoding`), or any non-ASCII byte (`non-ascii`);
3. split on the first `:`; require the scheme to be `tii` case-insensitively
   (`missing-scheme` / `bad-scheme`);
4. reject a remainder beginning `//` (`authority`), or containing `/` (`path`),
   `?` (`query`), or `=` (`padding`);
5. require exactly 26 alphabet characters (`bad-length` / `bad-char`);
6. Base32-decode with the zero-tail rule (`non-canonical-tail`);
7. lowercase the scheme and token and return `tii:` + token (the fragment, if
   any, is discarded).

The strict form `parseCanonicalTII` performs steps 2–7 and additionally rejects
a fragment with `has-fragment` (it is a URI reference, not a canonical TII).
`parseTIIReference` performs step 1 then 2–7 and returns both the canonical
`tii` and the separated `fragment`.

Canonicalization is **idempotent**. Surrounding whitespace is rejected, not
trimmed — callers trim first if they intend to. There are no version numbers or
metadata after the token; a future spec that needs a compound reference
construct MUST define it as an *independent* syntax, not an extension of
`tii:<token>`.

## 7. Validation & parse errors

Two parsers:

- `parseCanonicalTII(input)` → `{ scheme, token, bytes, canonical }` or throws.
  Strict: only `tii:<token>`.
- `parseTIIReference(input)` → `{ tii, token, bytes, fragment }` or throws.
  RFC 3986 URI reference: an optional trailing `#fragment` is separated first;
  `fragment` is `null` when absent, `""` for a bare `#`, else the verbatim text.

Stable error `code`s (see `test-vectors.json`): `empty`, `not-a-string`,
`whitespace`, `percent-encoding`, `non-ascii`, `missing-scheme`, `bad-scheme`,
`authority`, `path`, `query`, `padding`, `bad-length`, `bad-char`,
`non-canonical-tail`, and — from `parseCanonicalTII` only — `has-fragment`
(the input is a URI reference with a fragment; use `parseTIIReference`).

`isWellFormed(x)` is `true` iff `parseCanonicalTII(x)` succeeds.
`isTIIReference(x)` is `true` iff `parseTIIReference(x)` succeeds.

## 8. Collision handling & issuance

Collision probability is negligible at any realistic scale (`freeze-audit.md`
§B), but issuance MUST still check:

```
loop:
  candidate ← generate()            # §3
  candidate ← canonicalize(candidate)
  if registry_contains(candidate):  # local uniqueness check against the ledger
      discard candidate             # it is NOT written to the ledger
      continue
  break
append event: tii.issued { tii: candidate, identifier_status: "<test|production>" }
```

- A discarded candidate is not a TII and does not enter the ledger.
- A committed **production** token MUST NOT ever be reused for a different
  reference, and MUST NOT be deleted.
- The `exists()` check is against the canonical ledger (the record of
  authority), not a cache.

## 9. Identifier vs. resolver

```
IDENTIFIER      tii:aaaqeayeaudaocajbifqydiob4
RESOLUTION URL  https://<resolver-base>/tii/aaaqeayeaudaocajbifqydiob4
```

Changing the resolver domain, server, hosting company, database, framework, or
network location MUST NOT change the TII. A production TII MUST NOT encode any
resolver hostname. `tiiarchive.vercel.app` is a deployment endpoint only and
MUST NOT appear in any production identifier or in canonical identity metadata.
The resolver base is configuration (`TII_RESOLVER_BASE_URL` or its successor).

## 10. Resolution behaviour

A resolver, given a token, returns a status and the available records. Behaviour
by case:

| Input / state | Response |
|---|---|
| Valid, active production TII | `200`; current records, events, modules, checkpoints as available. |
| Valid production TII, **withdrawn** | `200` (or `410` with a body); a tombstone status explaining the withdrawal and its history. **Never a bare `404`.** |
| Valid production TII, **contested** | `200`; records plus the contestation history; no auto-resolution of the dispute. |
| Valid production TII, **no current address** | `200`; "no resolvable address currently recorded"; the identifier and its history still resolve. |
| Valid production TII, **issuance considered invalid** | `200`/`410` with a body; explains that issuance is recorded as invalid; the identifier is not reassigned. |
| **Unknown** token (never issued) | `404` with a body that says "not issued in this deployment" — distinct from withdrawn/invalid. |
| **Syntactically invalid** input | `400`; the parse-error `code`; distinct from `404`. |
| **Test** identifier | `200`; prominently marked `TEST IDENTIFIER`. |
| Future unsupported spec version referenced by a record | `200`; renders what it can; notes the unsupported version rather than failing. |

Unknown, invalid, withdrawn, and invalidly-issued identifiers MUST remain
mutually distinguishable.

If the input is a URI reference `tii:<token>#<fragment>`, the resolver strips
the fragment before lookup (RFC 3986: the fragment is not sent to the server).
Registry lookup and the responses above are by the fragmentless `tii:<token>`.
A client MAY re-apply the fragment to the returned representation; the resolver
assigns it no meaning.

## 11. Withdrawal

A withdrawal is an **appended event** (`tii.retracted` / a withdrawal record).
The `tii.issued` event is never mutated. The resolver returns a tombstone-style
status. A production TII does not become a `404` merely because it is no longer
active — its resolution record remains capable of explaining its status
indefinitely.

## 12. Invalid issuance

For a production identifier minted by mistake:

1. The identifier **remains historically issued** — `tii.issued` is not touched.
2. Append an event expressing that the issuance is **considered invalid**
   (reason class in `content`, revisable vocabulary — not a new core state).
3. The identifier is **not** assigned to another reference.
4. The resolver explains the status (§10).

## 13. Non-reuse & non-deletion

After production issuance a TII MUST NOT be reused for another reference and
MUST NOT disappear because: the record was erroneous, publication was withdrawn,
an address vanished, ownership or stewardship changed, a classification was
rejected, the referenced material was deleted, or the operator ceased to exist.
"Deletion" is never erasure of historical issuance; it is an appended
withdrawal / invalidation / tombstone.

## 14. Stewardship transfer

An appended event recording: previous steward, new steward, effective time,
evidence, authorization or signature, and contestation where relevant. The
steward is a **relation**, never in the token. A change of steward does not mint
a new TII. See [`succession-policy.md`](succession-policy.md).

## 15. Signing model

The SHA-256 event chain (repository `SPEC.md` §5.3) detects modification
relative to a known head but does not attest *who* produced it. Production adds
periodic **Ed25519**-signed checkpoints (RFC 8032), via standard runtime crypto
(`node:crypto`). No blockchain, token, or cryptoasset.

The event-chain canonicalization (repository `src/canonical.js`) and the
checkpoint canonicalization (§17, RFC 8785 JCS) are **separate**. The ledger
format is not migrated or changed: every existing event hash already fixes it.
Checkpoints are a new artifact and adopt the cross-implementation standard.

## 16. Key management & rotation

Keys are managed independently of identifier identity. A **keyset** lists, per
key: `key_id`, public key (PEM/SPKI), `not_before`, optional `not_after`,
optional `revoked_at`. Supported operations: current signing key, rotation,
compromised-key declaration, historical verification, transfer of signing
responsibility, multiple future signing authorities.

A rotation MUST NOT invalidate old signatures: a checkpoint is verified against
the key whose validity window contains the checkpoint's `created_at`. A
checkpoint dated after a key's window or `revoked_at` is rejected. No single
human or institution need hold one private key forever. The signing key's
identity is never placed in the TII token.

## 17. Signed checkpoint format & portability

A checkpoint object minimally binds:

```jsonc
{ "tii_checkpoint": "1",
  "ledger_head_hash": "<hex>",
  "event_count": <int>,          // sequence position
  "created_at": "<ISO 8601>",
  "spec_version": "<x.y.z|null>" }
```

**Normative signing input:** the UTF-8 bytes of the **RFC 8785 (JSON
Canonicalization Scheme, JCS)** canonicalization of the checkpoint object. JCS
fixes: whitespace (none), property order (sorted by UTF-16 code units of the
name), number serialization (ECMAScript `Number::toString`), and minimal string
escaping; and it requires **duplicate property names to be rejected** before the
content is signed or verified. Never sign rendered HTML or an unstable
serialization. Reference implementation: `src/candidate/jcs.js`
(`canonicalize` + a strict, duplicate-rejecting `parse`).

A signed checkpoint file:

```jsonc
{ "tii_signed_checkpoint": "1", "algorithm": "ed25519",
  "canonicalization": "RFC8785-JCS",
  "key_id": "<hex16>", "public_key": "<PEM>",
  "checkpoint": { … }, "signature": "<base64>" }
```

Signed checkpoints are ordinary UTF-8 files; the on-disk form MAY be
pretty-printed (whitespace does not affect verification — the signing input is
JCS of `.checkpoint`). Verification requires only the file (self-describing) or a
keyset file — **not** Vercel, the production database, a proprietary API, or the
original UI. A re-imported file with a duplicate property is rejected at parse
time. References: `src/candidate/checkpoint.js`, `src/candidate/jcs.js`.

## 18. External witnesses

Repositories, archival services, RFC 3161 timestamp authorities, institutional
mirrors, and independent TII mirrors MAY hold copies of signed checkpoints and
exported ledgers as **optional** witnesses. TII validity MUST NOT depend on any
single witness; the system remains reconstructable and verifiable from an
exported ledger + keyset alone if every witness disappears. Blockchain is not
required.

## 19. Specification versioning

`major.minor.patch`. Semantic-versioning intuitions are adapted, not adopted
wholesale. Change classes:

| Class | Bump | Definition | Constraint |
|---|---|---|---|
| Editorial | patch | wording, examples, typos | no normative effect |
| Backward-compatible extension | minor | new optional records, new event types, new modules, new checkpoint fields | existing identifiers and records keep their meaning |
| Interpretation-affecting | minor **and** a recorded interpretation note | changes how existing records are *read* (e.g. projection rules) | the change is itself an inspectable, dated record; prior-era records retain their prior interpretation context |
| Breaking | major | new token profile, new canonical form, incompatible resolution semantics | applies to **new** identifiers only; never rewrites the meaning of previously issued ones |

A new specification version MUST NOT silently change the historical meaning of
previously issued records (repository `SPEC.md` §7.1).

## 20. Version MUST NOT enter the token

Forms such as `tii:v1:…`, `tii:2026:…`, `tii:pa:…` are **prohibited** absent a
demonstrated overwhelming interoperability need. Specification/version
information belongs in records, manifests, or protocol negotiation — never in
the opaque reference token. The token is independent of specification revisions.

## 21. Multiple issuers

Globally-random 128-bit tokens permit independent future issuance **without**
issuer prefixes. The preferred property: issuer identity is a recorded
relation/event, not encoded in the identifier. Two independent issuers drawing
128-bit random tokens collide with probability `≈ (n₁·n₂)/2^128` — negligible.
Institutional sub-prefixes MUST NOT be introduced for administrative
convenience.

## 22. Succession

See [`succession-policy.md`](succession-policy.md). The policy distinguishes
*identifier persistence* from *availability of a particular resolver* from
*continued institutional operation*, and makes no claim of metaphysical or
absolute permanence.

## 23. Security considerations

See `freeze-audit.md` §G for the full threat table. Summary of normative points:

- Strict canonical form; no character substitution; homoglyph digits (`0 1 8 9`)
  are not in the alphabet.
- The identifier is resolver-independent; clients can verify a ledger head from
  any source against a signed checkpoint.
- Ledger tampering is detected by the SHA-256 chain + signed checkpoints;
  key compromise is handled by keyset revocation and multi-location publication;
  stale checkpoint replay is detectable via `event_count` / head hash.
- Event content is data, never instructions: resolvers escape all content, never
  execute it, and never auto-follow external URLs.
- **A valid TII does not imply valid, safe, true, authentic, scholarly, or
  approved content.** A resolver MUST NOT trust or execute content because it is
  associated with a valid TII.
- 128-bit random tokens are not enumerable.

## 24. Privacy considerations

The existence of an append-only canonical record is separate from public
disclosure of every field. TII does not assume all event history is public.

Model (implementation deferred): an event MAY carry a `disclosure` class
(`public` default / `restricted` / `embargoed-until`). For non-public payloads,
the ledger stores a commitment (salted hash) plus non-sensitive metadata; the
protected payload is held out-of-band. Redaction is an **appended event**
recording that a restriction occurred, its reason class, and the commitment —
never a deletion. Auditors can prove a restriction happened and later verify a
released payload against its commitment. Personal data, security-sensitive
addresses, and embargoed material use this path. Privacy is never achieved by
deleting historical events.

## 25. Test identifiers

`identifier_status: "test"` metadata is sufficient to separate experimental from
production identifiers. "test" is NOT added to the token. The resolver marks
experimental identifiers `TEST IDENTIFIER` visibly. No current test identifier
is promoted by a status flip; production begins with newly minted 26-character
identifiers after the freeze (see `freeze-audit.md` §26/§27).

## 26. Examples

```
tii:aaaqeayeaudaocajbifqydiob4          (canonical; decodes to 000102…0f)
tii:AAAQEAYEAUDAOCAJBIFQYDIOB4          (accepted on input → normalises to the above)
tii:77777777777777777777777774          (canonical; decodes to ff…ff)

tii:aaaqeayeaudaocajbifqydiob4#note-2   (a URI reference; underlying TII is
                                        tii:aaaqeayeaudaocajbifqydiob4;
                                        fragment "note-2" is not part of the
                                        identifier and does not affect lookup)

https://resolver.example/tii/aaaqeayeaudaocajbifqydiob4     (a resolution URL, not the identifier)
```

Illustrative only — none of these are issued.

## 27. Interoperability

- The token is entirely RFC 3986 `unreserved`; a TII is safe in URLs, path
  segments, filenames, JSON, CSV, XML, and shell arguments without escaping.
- Stored as `CHAR(26)` (token) or `CHAR(30)` (full TII). No hyphens, no case
  folding, no reserved characters.
- The full archival export is: the JSONL ledger, the signed checkpoint files,
  and the keyset file — all plain UTF-8. Any implementation can reconstruct
  derived state, re-verify the SHA-256 event chain (using the ledger's own
  canonicalization), and re-verify the Ed25519 checkpoint signatures (using
  RFC 8785 JCS of each `checkpoint` object) with no shared code.

## 28. IANA considerations

Register `tii` as a **Provisional** URI scheme per RFC 7595. Draft template:
[`iana-provisional-registration.md`](iana-provisional-registration.md). The
registry MUST be re-checked for `tii` immediately before first production
issuance. Contact and change-controller fields remain `PROVISIONAL` pending TII
governance and MUST NOT be hard-coded before then.

---

## Appendix A. Reference implementation

`src/candidate/identifier.js` (syntax; `parseCanonicalTII` /
`parseTIIReference`), `src/candidate/jcs.js` (RFC 8785 JCS canonicalize + strict
parser), `src/candidate/checkpoint.js` (Ed25519 signing over JCS). Tests:
`test/candidate-identifier.test.js`, `test/candidate-jcs.test.js`,
`test/candidate-checkpoint.test.js`. Vectors: `spec/test-vectors.json`
(regenerate: `node spec/gen-test-vectors.js`). None of these are imported by the
running system; production issuance is disabled.
