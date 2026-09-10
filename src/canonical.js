'use strict';

/**
 * Deterministic JSON serialization: object keys sorted recursively (lexicographic
 * by UTF-16 code unit, matching Array.prototype.sort default). Used only for
 * hashing — NOT for storage (stored lines keep insertion order for readability).
 *
 * `undefined` values are not expected here; the ledger strips them before hashing.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') +
    '}'
  );
}

/** Recursively drop keys whose value is `undefined`. Returns a new structure. */
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

module.exports = { canonicalize, stripUndefined };
