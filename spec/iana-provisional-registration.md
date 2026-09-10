# IANA Provisional URI Scheme Registration — DRAFT

Scheme: `tii` · Template per **RFC 7595** (Guidelines and Registration
Procedures for URI Schemes).

> **DRAFT FOR REVIEW — do not submit.** This is prepared for the freeze audit.
> `Contact` and `Change controller` are deliberately left `PROVISIONAL` and MUST
> NOT be filled in or hard-coded until TII governance is approved. The IANA URI
> Schemes registry was checked during this audit and contained **no** `tii`
> entry; this MUST be re-checked immediately before any submission or first
> production issuance.

---

## Registration template (RFC 7595 §7.4)

**Scheme name:**
`tii`

**Status:**
Provisional

**Applications/protocols that use this scheme name:**
The Transition-Ignition Identifier (TII) reference and audit infrastructure. TII
identifiers name reference points whose descriptions, relations, addresses,
interpretations, transitions, and classifications are recorded as an append-only,
auditable history. A `tii:` URI is a persistent, resolver-independent identifier;
it is resolved (when a resolver is available) via an HTTPS resolution URL of the
form `https://<resolver-base>/tii/<token>`.

**Contact:**
PROVISIONAL — to be provided by the TII change controller once governance is
established. Not hard-coded in the specification or implementation before then.

**Change controller:**
PROVISIONAL — to be provided once TII governance is established (expected: a
named steward organization or a governance body, explicitly transferable).

**References:**
- *TII Identifier Syntax and Resolution Specification* (the stable public
  specification; cite the frozen 1.0 version once accepted).
- RFC 3986 (URI Generic Syntax), RFC 4648 (Base32), RFC 8032 (Ed25519),
  RFC 5234 (ABNF).

---

## Scheme syntax (RFC 7595 §3.2)

ABNF (RFC 5234), compatible with RFC 3986:

```abnf
tii           = "tii:" tii-token            ; the canonical identifier
tii-token     = 25(base32) base32-final
base32        = %x61-7A / "2" / "3" / "4" / "5" / "6" / "7"   ; a-z 2-7
base32-final  = "a" / "e" / "i" / "m" / "q" / "u" / "y" / "4"

tii-reference = tii [ "#" fragment ]         ; RFC 3986 URI reference; the
                                             ; fragment is a generic component
```

The token is 128 bits of cryptographically secure random data, RFC 4648 Base32,
unpadded, lowercase, exactly 26 characters. A canonical `tii` has no authority,
path, or query component. A `#fragment`, when present, is a generic RFC 3986
component (RFC 3986 §3.5): it is separated before any scheme-specific
processing, is removed before resolution, does not affect registry lookup, and
is assigned no `tii`-specific semantics. On input the scheme is case-insensitive
(RFC 3986 §3.1) and the Base32 letters may be uppercase; the canonical form is
entirely lowercase.

## Scheme semantics (RFC 7595 §3.3)

A `tii:` URI identifies a TII reference point. It carries no semantic metadata:
it does not encode an issuer, owner, organization, country, date, object type,
version, state, transition, ignition status, address, domain, boundary, lineage,
or classification. Dereferencing is optional and is performed against a
configurable resolver; the identifier does not change if the resolver, its
domain, host, database, or provider changes. A valid `tii:` URI does not imply
that associated content is valid, authentic, safe, true, or approved.

## Encoding considerations (RFC 7595 §3.4)

The token consists solely of RFC 3986 `unreserved` characters (`a-z`, `2-7`);
no percent-encoding is used or permitted within a `tii:` URI. There is no
internationalization consideration: the token is ASCII-only by construction and
contains no natural-language text.

## Interoperability considerations (RFC 7595 §3.5)

There is exactly one canonical textual form of a `tii`. Implementations MUST
reject non-canonical input rather than repair it (no character substitution such
as `0`→`o` or `1`→`l`; no acceptance of Base32 `=` padding; no whitespace,
authority, path, or query). A `#fragment` is handled per RFC 3986 (separated,
not part of the identifier), not rejected as malformed. Because 128 bits over 26
Base32 symbols leaves two trailing zero bits, the final character is constrained
to `{a, e, i, m, q, u, y, 4}` and decoders MUST reject other final characters
(RFC 4648 §3.5). Machine-readable test vectors accompany the specification.

## Security considerations (RFC 7595 §3.6)

See the specification's Security Considerations. In brief: tokens are 128-bit
CSPRNG values and are neither guessable nor enumerable; the identifier is
resolver-independent, limiting the impact of resolver or domain compromise;
ledger integrity is protected by a SHA-256 event chain plus Ed25519-signed
checkpoints; a valid `tii:` URI conveys no trust about associated content, and
resolvers must treat all associated content as data, never as instructions.

## Additional information

- Contact for further information: PROVISIONAL.
- Author/Change controller: PROVISIONAL.
- IANA registry entry checked absent as of this audit; re-check before
  submission.

---

## Launch gate (binding)

No production identifier using the `tii:` scheme may be issued until:

1. the identifier syntax is frozen (spec 1.0 accepted);
2. the public specification is stable enough to cite as the scheme's defining
   reference;
3. the current IANA registry has been re-checked for `tii`;
4. a decision is recorded on whether to file this provisional registration (with
   reasons either way), including who the change controller will be.
