# IANA Provisional URI Scheme Registration — DRAFT (near-submission-ready)

Scheme: `tii` · Template per **RFC 7595** (Guidelines and Registration
Procedures for URI Schemes).

> **DRAFT — NOT SUBMITTED. Do not send this to IANA.** No email was sent, no
> form was completed, nothing here is registered. The technical fields
> (Scheme syntax, Encoding, Interoperability, Security, Fragment handling,
> Resolution) reflect the **accepted frozen candidate** and are ready. The
> governance fields (**Contact**, **Change controller**, **Specification URL**)
> are **CANDIDATE / UNRESOLVED** and are marked as such inline; they MUST NOT be
> filled in with final values or hard-coded anywhere until TII governance and
> the permanent domain are explicitly approved.
>
> **IANA status re-check (2026-09-11):** the IANA *URI Schemes* registry
> contains **no** `tii` entry — not Permanent, not Provisional, not Historical
> (adjacent: `things` provisional, `thismessage` permanent). This MUST be
> re-checked again immediately before submission and before first production
> issuance. **If `tii` is found registered by another party: STOP** — do not
> submit, do not issue any production `tii:` identifier, do not improvise
> another scheme; report the collision and require a new naming decision.

Legend: **[TECH — ready]** = accepted frozen candidate. **[GOV — unresolved]** =
placeholder pending governance / domain approval.

---

## Registration template (RFC 7595 §7.4)

**Scheme name:** — **[TECH — ready]**
`tii`

**Status:** — **[TECH — ready]**
Provisional *(not Permanent at this stage)*

**Applications/protocols that use this scheme name:** — **[TECH — ready]**
The Transition-Ignition Identifier (TII) reference and audit infrastructure. A
`tii:` URI is a persistent, opaque, resolver-independent identifier for a
reference point whose descriptions, relations, addresses, interpretations,
transitions, and classifications are recorded as an append-only, auditable
history. Dereferencing is optional and, where a resolver is available, is
performed over HTTPS at `https://<resolver-base>/tii/<token>`; the resolver base
is deployment configuration and is not part of the identifier.

**Contact:** — **[GOV — unresolved]**
*Named responsible person: PROVISIONAL — requires explicit approval; not
published here.* Preferred long-term public contact: the role address
`standards@<approved-domain>` — **the permanent domain is not yet chosen and
this address does not exist** (see `resolver-domain-decision.md`,
`governance-candidate.md` §3–4). A personal webmail address will not be used as
the long-term public standards contact once a domain role address exists.

**Change controller:** — **[GOV — unresolved]**
*Candidate:* **P/A Institute, acting as the current steward of the TII
specification.** **Pending explicit approval.** Per the specification, "the
change controller is a current stewardship role and is not part of TII
identifier identity; stewardship may be transferred under the TII Succession
Policy." The change controller is never encoded into any identifier.

**References:** — **[TECH ready / GOV url unresolved]**
- *TII Identifier Syntax and Resolution Specification* — the stable public
  specification. **Canonical URL PENDING the permanent domain**; cite the
  frozen `1.0` version once accepted. (Interim source:
  `https://github.com/n-fujie/TII` — a source repository, not the permanent
  specification home.)
- RFC 3986 (URI Generic Syntax), RFC 4648 (Base32), RFC 8032 (Ed25519),
  RFC 8785 (JSON Canonicalization Scheme), RFC 5234 (ABNF), RFC 7595
  (URI scheme registration).

---

## Scheme syntax (RFC 7595 §3.2) — **[TECH — ready]**

ABNF (RFC 5234), compatible with RFC 3986:

```abnf
tii           = "tii:" tii-token            ; the canonical identifier
tii-token     = 25(base32) base32-final
base32        = %x61-7A / "2" / "3" / "4" / "5" / "6" / "7"   ; a-z 2-7
base32-final  = "a" / "e" / "i" / "m" / "q" / "u" / "y" / "4"

tii-reference = tii [ "#" fragment ]         ; RFC 3986 URI reference
fragment      = *( pchar / "/" / "?" )       ; RFC 3986 §3.5, verbatim
```

The token is 128 bits of cryptographically secure random data, RFC 4648 Base32,
unpadded, lowercase, exactly 26 characters. A canonical `tii` has no authority,
path, or query component. Total canonical length: 30 characters.

## Scheme semantics (RFC 7595 §3.3) — **[TECH — ready]**

A `tii:` URI identifies a TII reference point. It carries **no semantic
metadata**: it does not encode an issuer, owner, organization, country, date,
object type, version, state, transition, ignition status, address, domain,
boundary, lineage, or classification. Issuing a `tii:` identifier means only
that tracking has started from a stated reference point. The identifier does not
change if the resolver, its domain, host, database, provider, registrar, or
operating organization changes. A valid `tii:` URI does not imply that any
associated content is valid, authentic, safe, true, scholarly, or approved.

## Encoding considerations (RFC 7595 §3.4) — **[TECH — ready]**

The token consists solely of RFC 3986 `unreserved` characters (`a`–`z`, `2`–`7`);
percent-encoding is neither used nor permitted within a `tii:` URI. There is no
internationalization consideration: the token is ASCII-only by construction and
contains no natural-language text.

## Fragment handling under RFC 3986 — **[TECH — ready]**

A reference of the form `tii:<token>#<fragment>` is a valid **URI reference**,
not an invalid `tii:` URI. Per RFC 3986 §3.5 the fragment is everything from the
first `#` to the end of the string. It is:

- separated **before** any TII scheme-specific processing;
- **removed before resolution** — it is not sent to the resolver and does not
  affect registry lookup, which is by the fragmentless `tii:<token>`;
- assigned **no** `tii`-scheme-specific semantics; an implementation MUST NOT
  invent any.

The canonical `tii` underlying `tii:<token>#x` is `tii:<token>`. A client MAY
re-apply the fragment to the retrieved representation.

## Interoperability considerations (RFC 7595 §3.5) — **[TECH — ready]**

There is exactly one canonical textual form of a `tii`. Implementations MUST
reject non-canonical input rather than repair it:

- no character substitution (`0`→`o`, `1`→`i`/`l`, `8`→`b`, etc.) — such
  characters are outside the alphabet and are a hard error;
- no acceptance of Base32 `=` padding;
- no whitespace, authority, path, or query component.

Because 128 bits over 26 Base32 symbols leaves two trailing zero bits
(RFC 4648 §3.5), the final character is one of `{a, e, i, m, q, u, y, 4}`;
decoders MUST reject any other final character. On input the scheme is
case-insensitive (RFC 3986 §3.1) and the Base32 letters may be uppercase; the
canonical output is entirely lowercase. Machine-readable test vectors
accompany the specification (`spec/test-vectors.json`).

## Resolution behaviour — **[TECH — ready]**

Resolution is optional. Where provided, a resolver at
`https://<resolver-base>/tii/<token>` returns:

| Request | Response |
|---|---|
| valid, active identifier | `200` — records / structured data |
| valid, **withdrawn** identifier | `200` (or `410` + body) — a tombstone status; **never a bare `404`** |
| valid identifier, issuance recorded **invalid** | `200`/`410` + body — explains status; identifier not reassigned |
| **unknown** token (never issued) | `404` + body — distinct from withdrawn/invalid |
| **syntactically invalid** input | `400` + parse-error code — distinct from `404` |
| `#fragment` present | stripped before lookup; response is for the fragmentless token |

HTTPS is required; HTTP redirects to HTTPS. HTTP availability is **not**
identifier validity.

## Security considerations (RFC 7595 §3.6) — **[TECH — ready]**

- Tokens are 128-bit CSPRNG values: not guessable, not enumerable (no sequential
  space).
- The identifier is resolver-independent, limiting the impact of resolver,
  domain, or hosting compromise; clients can verify a ledger head obtained from
  any source against an Ed25519-signed checkpoint (signing input: RFC 8785 JCS
  of the checkpoint object).
- Ledger integrity: a SHA-256 event chain plus periodic signed checkpoints;
  key compromise is handled by keyset revocation and multi-location publication.
- Homoglyph digits (`0 1 8 9`) are not in the alphabet; look-alike input is a
  hard parse error, never repaired.
- A valid `tii:` URI conveys **no** trust about associated content. A resolver
  MUST treat all associated content as data — never as instructions — MUST NOT
  execute it, and MUST NOT auto-follow external URLs found in it.

## Examples — **[TECH — ready]**

```
tii:aaaqeayeaudaocajbifqydiob4          canonical (decodes to 00 01 02 … 0f)
tii:AAAQEAYEAUDAOCAJBIFQYDIOB4          accepted on input; normalises to the above
tii:77777777777777777777777774          canonical (decodes to ff … ff)
tii:aaaqeayeaudaocajbifqydiob4#note-2   a URI reference; underlying TII is
                                        tii:aaaqeayeaudaocajbifqydiob4
```

Illustrative only — none of these identifiers has been issued.

## Additional information

- All currently issued `tii:` identifiers carry `identifier_status: "test"`;
  production issuance is disabled.
- IANA registry entry for `tii` checked **absent 2026-09-11**; re-check
  immediately before submission and before first production issuance.

---

## Launch gate (binding)

No production identifier using the `tii:` scheme may be issued until **all** of:

1. the identifier syntax is frozen (spec `1.0` accepted);
2. the public specification is stable and citable at a permanent URL;
3. the IANA registry has been **re-checked** for `tii` (STOP if registered);
4. the change controller and IANA contact are **approved** (not the candidates
   above);
5. the permanent resolver domain is **approved** (so the specification URL and
   role addresses can be finalized);
6. a decision is recorded on whether to **file** this provisional registration,
   with reasons either way.

Steps 4–6 are governance decisions and are **not made by this task**.

---

## G9 re-check (Production Launch Gate phase, 2026-09-11)

Immediately re-checked the official IANA *URI Schemes* registry
(`https://www.iana.org/assignments/uri-schemes/uri-schemes.xhtml`) as
required before any production launch decision. Result: **`tii` still does
not appear as a registered or provisional scheme.** The closest neighboring
entries by name are `tip` (Transaction Internet Protocol, Permanent) and
`tn3270` (Permanent) — neither is a collision or a near-miss requiring a
naming change. No STOP condition is triggered.

This does **not** change the status of this draft: it remains **NOT
SUBMITTED**, and steps 4–6 above (contact, change controller, and a file/
don't-file decision) remain governance decisions outside this task's
authority — see `spec/production-launch-gate.md` G8/G9 for the current,
explicit UNRESOLVED status of those decisions. The registry MUST be
re-checked again, a final time, immediately before actual submission (should
that ever be separately authorized) and again immediately before any first
production issuance, per the original launch gate above.
