'use strict';

/**
 * TII Identifier Syntax 1.0 — the PRODUCTION identifier profile.
 *
 * Promoted from src/candidate/identifier.js (freeze audit,
 * spec/identifier-syntax-1.0-candidate.md) during the Production Launch Gate
 * phase (spec/production-launch-gate.md, G1/G2). It is now wired into
 * src/production-issuance.js and bin/tii.js `issue --production`, but
 * PRODUCTION ISSUANCE ITSELF REMAINS DISABLED — every call into the
 * production issuance path is gated by src/production-gate.js, which is
 * closed by default and requires multiple independent conditions to all be
 * true before a production identifier can be minted (none of them are true
 * in this repository's committed configuration). See
 * test/production-gate.test.js for the fail-closed matrix.
 *
 * TEST issuance is completely unaffected by this module: src/id.js's
 * provisional 12-character generator remains the only thing src/ledger.js's
 * issueTII() (the TEST path) ever calls. This module — 26-character tokens —
 * and src/id.js's 12-character tokens are syntactically distinct on sight,
 * which is a deliberate, additional separation between test and production
 * identifiers beyond the identifier_status field (spec/production-launch-gate.md §6).
 *
 * ── Frozen profile — TII Identifier Syntax 1.0 ─────────────────────────────
 *   identifier   : "tii:" <token>
 *   token        : 128 bits of CSPRNG entropy, RFC 4648 Base32, unpadded,
 *                  lowercase, exactly 26 characters
 *   alphabet     : a-z 2-7  (RFC 4648 "Base 32 Alphabet", lowercased)
 *   canonical    : exactly one textual form; scheme + token both lowercase
 *   no semantics : the token encodes 16 random bytes and nothing else
 */

const crypto = require('node:crypto');

const SCHEME = 'tii';
const ENTROPY_BYTES = 16; // 128 bits
const TOKEN_LENGTH = 26; // ceil(128 / 5)
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC 4648, lowercased
const ALPHABET_UC = ALPHABET.toUpperCase();

// 128 bits over 26 symbols leaves the last symbol carrying only 3 data bits;
// its low 2 bits MUST be zero in canonical form (RFC 4648 §3.5). Valid final
// symbols are therefore alphabet indices 0,4,8,12,16,20,24,28:
const LAST_CHAR_SET = new Set([0, 4, 8, 12, 16, 20, 24, 28].map((i) => ALPHABET[i]));
// => a e i m q u y 4

class TiiSyntaxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TiiSyntaxError';
    this.code = code; // stable machine code, see spec/test-vectors.json
  }
}

/* ------------------------------------------------------ RFC 4648 Base32 --- */

/** Encode exactly 16 bytes to 26 lowercase Base32 chars, no padding. */
function base32Encode(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('base32Encode expects a Buffer/Uint8Array');
  }
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Strict decode: input must be exactly TOKEN_LENGTH chars over the alphabet
 * (case-insensitive), and the trailing bits that fall outside the 128-bit
 * payload MUST be zero. No character substitution of any kind.
 */
function base32Decode(token) {
  if (typeof token !== 'string') throw new TiiSyntaxError('not-a-string', 'token must be a string');
  if (token.length !== TOKEN_LENGTH) {
    throw new TiiSyntaxError('bad-length', `token must be exactly ${TOKEN_LENGTH} characters, got ${token.length}`);
  }
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of token) {
    let idx = ALPHABET.indexOf(ch);
    if (idx === -1) idx = ALPHABET_UC.indexOf(ch);
    if (idx === -1) {
      throw new TiiSyntaxError('bad-char', `character not in Base32 alphabet: ${JSON.stringify(ch)}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Whatever bits remain (here: 2) must be zero for a canonical encoding.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new TiiSyntaxError('non-canonical-tail', 'trailing bits are non-zero (not a canonical Base32 encoding of 128 bits)');
  }
  if (bytes.length !== ENTROPY_BYTES) {
    throw new TiiSyntaxError('bad-length', `decoded to ${bytes.length} bytes, expected ${ENTROPY_BYTES}`);
  }
  return Buffer.from(bytes);
}

/* ---------------------------------------------------------- generation --- */

/**
 * 16 bytes from the platform CSPRNG. crypto.randomBytes throws if secure
 * randomness is unavailable — this function fails closed and never falls back
 * to any non-cryptographic source.
 */
function randomEntropy() {
  const buf = crypto.randomBytes(ENTROPY_BYTES);
  if (!Buffer.isBuffer(buf) || buf.length !== ENTROPY_BYTES) {
    throw new Error('CSPRNG did not return the expected number of bytes');
  }
  return buf;
}

/** A fresh candidate token (26 chars). Not yet a TII until issuance commits it. */
function generateToken() {
  return base32Encode(randomEntropy());
}

/** A fresh candidate identifier string "tii:<token>". */
function generateIdentifier() {
  return SCHEME + ':' + generateToken();
}

/**
 * Issuance procedure (candidate). `exists(id)` is the registry uniqueness check.
 * A collided candidate is discarded and never entered into the ledger; only the
 * surviving candidate is returned for the caller to append as `tii.issued`.
 */
function issueIdentifier(exists, maxAttempts = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    const id = generateIdentifier();
    if (typeof exists === 'function' && exists(id)) continue; // discard, do not record
    return id;
  }
  throw new Error('issueIdentifier: uniqueness-check retries exhausted (implausible at 128-bit entropy)');
}

/* -------------------------------------------------- parse / canonicalize --- */

const TOKEN_RE = new RegExp(`^[${ALPHABET}${ALPHABET_UC}]{${TOKEN_LENGTH}}$`);

/** True iff `token` is already in canonical form (lowercase, 26, zero tail). */
function isCanonicalToken(token) {
  if (typeof token !== 'string' || token.length !== TOKEN_LENGTH) return false;
  if (!new RegExp(`^[${ALPHABET}]{${TOKEN_LENGTH}}$`).test(token)) return false;
  if (!LAST_CHAR_SET.has(token[TOKEN_LENGTH - 1])) return false;
  try {
    return base32Encode(base32Decode(token)) === token;
  } catch {
    return false;
  }
}

/**
 * Parse a **canonical TII** — exactly `tii:<token>` — into its parts, or throw
 * TiiSyntaxError with a stable `.code`. Accepts the scheme in any case
 * (RFC 3986 §3.1) and the token in upper or lower case; rejects everything else
 * explicitly. A `#fragment` is a valid *URI reference* per RFC 3986 but is NOT
 * part of a canonical TII — this parser reports `has-fragment` for it; use
 * `parseTIIReference` to separate the fragment.
 */
function parseCanonicalTII(input) {
  if (typeof input !== 'string') throw new TiiSyntaxError('not-a-string', 'identifier must be a string');
  if (input.length === 0) throw new TiiSyntaxError('empty', 'empty identifier');
  if (/\s/.test(input)) throw new TiiSyntaxError('whitespace', 'identifier contains whitespace');
  if (/%/.test(input)) throw new TiiSyntaxError('percent-encoding', 'percent-encoding is not allowed');
  if (/[^\x21-\x7e]/.test(input)) throw new TiiSyntaxError('non-ascii', 'identifier contains non-ASCII characters');

  const colon = input.indexOf(':');
  if (colon === -1) throw new TiiSyntaxError('missing-scheme', 'missing "tii:" scheme');
  const scheme = input.slice(0, colon);
  const rest = input.slice(colon + 1);
  if (scheme.toLowerCase() !== SCHEME) {
    throw new TiiSyntaxError('bad-scheme', `scheme must be "${SCHEME}", got ${JSON.stringify(scheme)}`);
  }
  if (rest.startsWith('//')) throw new TiiSyntaxError('authority', 'TII has no authority component ("//")');
  if (rest.includes('#')) {
    throw new TiiSyntaxError('has-fragment', 'this is a URI reference with a fragment, not a canonical TII — use parseTIIReference');
  }
  if (rest.includes('/')) throw new TiiSyntaxError('path', 'TII has no path component ("/")');
  if (rest.includes('?')) throw new TiiSyntaxError('query', 'TII has no query component ("?")');
  if (rest.includes('=')) throw new TiiSyntaxError('padding', 'Base32 padding ("=") is not allowed');
  if (!TOKEN_RE.test(rest)) {
    if (rest.length !== TOKEN_LENGTH) {
      throw new TiiSyntaxError('bad-length', `token must be exactly ${TOKEN_LENGTH} characters, got ${rest.length}`);
    }
    throw new TiiSyntaxError('bad-char', 'token contains a character outside the Base32 alphabet');
  }
  const bytes = base32Decode(rest); // also enforces the zero-tail canonical rule
  const token = rest.toLowerCase();
  return { scheme: SCHEME, token, bytes, canonical: `${SCHEME}:${token}` };
}

/** Back-compatible alias: `parse` is the strict canonical-TII parser. */
const parse = parseCanonicalTII;

/**
 * Parse a **TII URI reference** per RFC 3986: split a trailing `#fragment`
 * (everything from the first `#` to the end, RFC 3986 §3.5) BEFORE any
 * TII-specific processing, then require the part before `#` to be a canonical
 * TII. The fragment is a generic URI component: it is removed before
 * resolution, it does not affect registry lookup, and TII assigns it no
 * scheme-specific semantics.
 *
 *   parseTIIReference("tii:<token>")     → { tii, token, bytes, fragment: null }
 *   parseTIIReference("tii:<token>#x")   → { tii, token, bytes, fragment: "x" }
 *   parseTIIReference("tii:<token>#")    → { tii, token, bytes, fragment: "" }
 */
function parseTIIReference(input) {
  if (typeof input !== 'string') throw new TiiSyntaxError('not-a-string', 'reference must be a string');
  const hash = input.indexOf('#');
  const base = hash === -1 ? input : input.slice(0, hash);
  const fragment = hash === -1 ? null : input.slice(hash + 1);
  const parsed = parseCanonicalTII(base);
  return {
    tii: parsed.canonical, // the underlying TII, fragment removed
    token: parsed.token,
    bytes: parsed.bytes,
    fragment, // null if absent, "" if bare "#", else the fragment text (verbatim)
  };
}

/**
 * Return THE canonical identifier string for any acceptable reference form, or
 * throw. A `#fragment`, if present, is removed (it is not part of the
 * identifier and does not affect lookup). Idempotent.
 */
function canonicalize(input) {
  return parseTIIReference(input).tii;
}

/** True iff `input` is already a canonical TII (no fragment, no deviation). */
function isWellFormed(input) {
  try {
    parseCanonicalTII(input);
    return true;
  } catch {
    return false;
  }
}

/** True iff `input` is a well-formed TII URI reference (fragment allowed). */
function isTIIReference(input) {
  try {
    parseTIIReference(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a resolution URL for a resolver base. Any `#fragment` is dropped from
 * the lookup URL (RFC 3986: the fragment is not part of the request; a client
 * may re-apply it to the returned representation). The token is unchanged; the
 * identifier does not depend on the resolver, its domain, host, or provider.
 */
function resolutionUrl(resolverBase, idOrToken) {
  const s = /^tii:/i.test(idOrToken) ? idOrToken : SCHEME + ':' + idOrToken;
  const token = parseTIIReference(s).token;
  return resolverBase.replace(/\/+$/, '') + '/tii/' + token;
}

module.exports = {
  SCHEME,
  ENTROPY_BYTES,
  TOKEN_LENGTH,
  ALPHABET,
  LAST_CHAR_SET,
  TiiSyntaxError,
  base32Encode,
  base32Decode,
  randomEntropy,
  generateToken,
  generateIdentifier,
  issueIdentifier,
  isCanonicalToken,
  parse,
  parseCanonicalTII,
  parseTIIReference,
  canonicalize,
  isWellFormed,
  isTIIReference,
  resolutionUrl,
};
