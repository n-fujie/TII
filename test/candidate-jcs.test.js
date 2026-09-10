'use strict';

/**
 * RFC 8785 (JSON Canonicalization Scheme) conformance for src/candidate/jcs.js —
 * the signing input for candidate production signed checkpoints. Cross-
 * implementation oriented: property order, whitespace, Unicode, numeric edges,
 * duplicate-property rejection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const jcs = require('../src/candidate/jcs');

test('property order independence (RFC 8785 section 3.2.3)', () => {
  const a = { b: 1, a: 2, c: 3 };
  const b = { c: 3, a: 2, b: 1 };
  assert.equal(jcs.canonicalize(a), jcs.canonicalize(b));
  assert.equal(jcs.canonicalize(a), '{"a":2,"b":1,"c":3}');
  // sorting is by UTF-16 code units: "1" < "10" < "2" < "a"
  assert.equal(jcs.canonicalize({ 2: 0, a: 0, 10: 0, 1: 0 }), '{"1":0,"10":0,"2":0,"a":0}');
  assert.equal(
    jcs.canonicalize({ z: { y: 1, x: 2 }, a: [3, { q: 4, p: 5 }] }),
    '{"a":[3,{"p":5,"q":4}],"z":{"x":2,"y":1}}'
  );
});

test('whitespace independence: input formatting does not affect the canonical form', () => {
  const pretty = '{\n  "b": 1,\n  "a": [ 2, 3 ]\n}\n';
  const tight = '{"b":1,"a":[2,3]}';
  assert.equal(jcs.canonicalize(jcs.parse(pretty)), jcs.canonicalize(jcs.parse(tight)));
  assert.equal(jcs.canonicalize(jcs.parse(pretty)), '{"a":[2,3],"b":1}');
});

test('canonicalization matches the RFC 8785 Appendix B example', () => {
  // Appendix B input string, code point by code point:
  //   U+20AC '$' U+000F U+000A 'A' "'" 'B' U+0022 U+005C U+005C U+0022 '/'
  const rfcString = '\u20ac$\u000f\nA\'B"\\\\"/';
  const input = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
    string: rfcString,
    literals: [null, true, false],
  };
  // Expected canonical output (RFC 8785 Appendix B), as a JS string literal:
  const expected =
    '{"literals":[null,true,false],' +
    '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
  assert.equal(jcs.canonicalize(input), expected);
  assert.equal(jcs.canonicalize(jcs.parse(expected)), expected); // fixed point
});

test('numeric edge cases follow ECMAScript Number::toString (RFC 8785 section 3.2.2)', () => {
  const cases = [
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [1.0, '1'],
    [-1.5, '-1.5'],
    [10.1, '10.1'],
    [1e30, '1e+30'],
    [1e-30, '1e-30'],
    [1e21, '1e+21'],
    [1e20, '100000000000000000000'],
    [5e-324, '5e-324'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
    [333333333.33333329, '333333333.3333333'],
  ];
  for (const [n, want] of cases) assert.equal(jcs.serializeNumber(n), want, String(n));
  assert.throws(() => jcs.serializeNumber(NaN), (e) => e.code === 'non-finite-number');
  assert.throws(() => jcs.serializeNumber(Infinity), (e) => e.code === 'non-finite-number');
});

test('Unicode: non-ASCII is emitted as raw UTF-8, round-trips through parse', () => {
  const v = { title: '遷移発火識別子', emoji: '\u{1F511}', mixed: 'a—b\tc' };
  const c = jcs.canonicalize(v);
  assert.ok(c.includes('遷移発火識別子'));
  assert.ok(c.includes('\u{1F511}')); // non-BMP, emitted raw
  assert.equal(jcs.canonicalize(jcs.parse(c)), c); // idempotent
  assert.throws(() => jcs.canonicalize({ x: '\uD800' }), (e) => e.code === 'lone-surrogate');
});

test('duplicate property names are rejected before anything is signed (RFC 8785 section 3.1)', () => {
  assert.throws(() => jcs.parse('{"a":1,"b":2,"a":3}'), (e) => e.code === 'duplicate-key');
  assert.throws(
    () => jcs.parse('{"checkpoint":{"event_count":1,"event_count":2}}'),
    (e) => e.code === 'duplicate-key'
  );
  assert.deepEqual(jcs.parse('{"a":1,"b":2}'), { a: 1, b: 2 });
});

test('parse rejects trailing content and malformed input', () => {
  assert.throws(() => jcs.parse('{"a":1} extra'), (e) => e.code === 'trailing');
  assert.throws(() => jcs.parse('{"a":}'), (e) => e.code === 'syntax');
  assert.throws(() => jcs.parse('nul'), (e) => e.code === 'syntax');
});

test('canonicalize rejects values that are not valid JSON', () => {
  assert.throws(() => jcs.canonicalize(undefined), (e) => e.code === 'unsupported');
  assert.throws(() => jcs.canonicalize({ x: () => 1 }), (e) => e.code === 'unsupported');
  assert.throws(() => jcs.canonicalize(10n), (e) => e.code === 'bigint');
});
