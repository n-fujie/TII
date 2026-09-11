'use strict';

/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * LIVE — promoted from src/candidate/jcs.js in production-hardening Phase 1.
 * Used ONLY as the signing input for signed checkpoints (src/checkpoint.js,
 * src/checkpoint-store.js). It is completely separate from the historical
 * ledger canonicalization in src/canonical.js, which is unchanged and is NOT
 * migrated. This module has no opinion about TII identifier syntax.
 *
 *   checkpoint signing input = UTF-8 bytes of  canonicalize(checkpoint JSON)
 *
 * Scope: the JSON value space actually used by checkpoints (objects, arrays,
 * strings, finite numbers, booleans, null). Implemented against RFC 8785:
 *   §3.2.1 whitespace   — none emitted
 *   §3.2.2 numbers      — ECMAScript Number::toString (ECMA-262 §7.1.12.1);
 *                         negative zero serialized as "0"
 *   §3.2.3 property order— sorted by UTF-16 code units of the name
 *   §3.2.4 strings      — minimal escaping (", \, and C0 controls; "/" not
 *                         escaped; non-ASCII emitted as raw UTF-8; \uXXXX
 *                         lowercase). This is exactly JSON.stringify(string)
 *                         on a well-formed string.
 *   §3.1               — duplicate property names are an error (enforced by
 *                         parse(), below, before anything is signed/verified).
 */

class JcsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JcsError';
    this.code = code;
  }
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serializeString(s) {
  if (LONE_SURROGATE.test(s)) {
    throw new JcsError('lone-surrogate', 'string contains an unpaired UTF-16 surrogate');
  }
  // JSON.stringify on a well-formed string already matches RFC 8785 §3.2.4:
  // escapes only " \ \b \f \n \r \t and \u00xx (lowercase) for other C0
  // controls; does not escape "/"; emits non-ASCII as raw UTF-8.
  return JSON.stringify(s);
}

function serializeNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new JcsError('non-finite-number', `not a finite JSON number: ${String(n)}`);
  }
  if (Object.is(n, -0)) return '0';
  return String(n); // ECMAScript Number::toString — what RFC 8785 §3.2.2 mandates
}

function canonicalize(value) {
  return ser(value);
}

function ser(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return serializeNumber(v);
  if (t === 'string') return serializeString(v);
  if (t === 'bigint') throw new JcsError('bigint', 'BigInt is not valid JSON');
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new JcsError('unsupported', `value of type "${t}" cannot be canonicalized`);
  }
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  if (t === 'object') {
    // RFC 8785 §3.2.3: sort by UTF-16 code units of the property name.
    // Array.prototype.sort's default comparator does exactly that.
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => serializeString(k) + ':' + ser(v[k])).join(',') + '}';
  }
  throw new JcsError('unsupported', 'cannot canonicalize value');
}

/* --------------------------------------------------------------- parse --- */

/**
 * Strict JSON parser that REJECTS duplicate object property names
 * (RFC 8785 §3.1). Returns the parsed value. Used by checkpoint.deserialize so
 * a re-imported checkpoint file with duplicate keys is rejected before any
 * signature check — `JSON.parse` would silently keep the last value.
 */
function parse(text) {
  if (typeof text !== 'string') throw new JcsError('not-a-string', 'input must be a string');
  const s = text;
  let i = 0;

  const err = (code, msg) => new JcsError(code, `${msg} at position ${i}`);
  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  };
  const expect = (ch) => {
    if (s[i] !== ch) throw err('syntax', `expected ${JSON.stringify(ch)}`);
    i++;
  };

  function value() {
    ws();
    const c = s[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (s.startsWith('true', i)) { i += 4; return true; }
    if (s.startsWith('false', i)) { i += 5; return false; }
    if (s.startsWith('null', i)) { i += 4; return null; }
    throw err('syntax', 'unexpected token');
  }

  function object() {
    expect('{');
    const out = {};
    const seen = new Set();
    ws();
    if (s[i] === '}') { i++; return out; }
    for (;;) {
      ws();
      if (s[i] !== '"') throw err('syntax', 'expected property name string');
      const key = string();
      if (seen.has(key)) throw new JcsError('duplicate-key', `duplicate property name ${JSON.stringify(key)}`);
      seen.add(key);
      ws();
      expect(':');
      out[key] = value();
      ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === '}') { i++; return out; }
      throw err('syntax', 'expected "," or "}"');
    }
  }

  function array() {
    expect('[');
    const out = [];
    ws();
    if (s[i] === ']') { i++; return out; }
    for (;;) {
      out.push(value());
      ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ']') { i++; return out; }
      throw err('syntax', 'expected "," or "]"');
    }
  }

  function string() {
    expect('"');
    let out = '';
    while (i < s.length) {
      const c = s[i++];
      if (c === '"') return out;
      if (c === '\\') {
        const e = s[i++];
        if (e === '"' || e === '\\' || e === '/') out += e;
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const hex = s.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw err('syntax', 'bad \\u escape');
          i += 4;
          out += String.fromCharCode(parseInt(hex, 16));
        } else throw err('syntax', 'bad escape');
      } else {
        out += c;
      }
    }
    throw err('syntax', 'unterminated string');
  }

  function number() {
    const start = i;
    if (s[i] === '-') i++;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (s[i] === '.') { i++; while (i < s.length && s[i] >= '0' && s[i] <= '9') i++; }
    if (s[i] === 'e' || s[i] === 'E') {
      i++;
      if (s[i] === '+' || s[i] === '-') i++;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    }
    const n = Number(s.slice(start, i));
    if (!Number.isFinite(n)) throw err('syntax', 'invalid number');
    return n;
  }

  const result = value();
  ws();
  if (i !== s.length) throw err('trailing', 'unexpected trailing content');
  return result;
}

module.exports = { canonicalize, parse, serializeNumber, serializeString, JcsError };
