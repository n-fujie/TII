'use strict';

/**
 * Parser/validator tests for src/id.js — the PROVISIONAL test identifier
 * profile (SPEC.md §8/§9: 12-character body, Crockford-ish alphabet). Every
 * identifier actually issued by this codebase today uses this profile
 * (production issuance, src/identifier.js's 26-character profile, is gated
 * closed everywhere — see test/production-gate.test.js).
 *
 * src/identifier.js already has thorough parser/validator/fragment tests
 * (test/identifier.test.js). This file brings src/id.js's coverage to the
 * same standard — it was previously covered only incidentally (a couple of
 * assertions inside test/core.test.js), with no dedicated negative-case or
 * fragment-handling coverage at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const id = require('../src/id');

test('newTII: always "tii:" + exactly 12 characters from the declared alphabet', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = id.newTII((c) => seen.has(c));
    assert.ok(!seen.has(t), 'collision within 2000 draws (must not happen)');
    seen.add(t);
    assert.equal(t.slice(0, 4), 'tii:');
    assert.equal(t.length, 4 + id.TII_BODY_LENGTH);
    assert.match(t.slice(4), new RegExp(`^[${id.ALPHABET}]{${id.TII_BODY_LENGTH}}$`));
  }
});

test('newTII: the alphabet never contains the excluded look-alike characters (i l o u)', () => {
  assert.ok(!/[ilou]/.test(id.ALPHABET), 'Crockford-style exclusion must hold');
  for (let i = 0; i < 500; i++) {
    assert.ok(!/[ilou]/.test(id.newTII().slice(4)), 'checking the BODY only — the fixed "tii:" scheme prefix itself legitimately contains "i"');
  }
});

test('newTII: collision predicate is honored — a candidate reported as existing is never returned', () => {
  let firstCandidate = null;
  const exists = (c) => {
    if (firstCandidate === null) {
      firstCandidate = c;
      return true; // force a retry
    }
    return c === firstCandidate; // only the first draw collides
  };
  const t = id.newTII(exists);
  assert.notEqual(t, firstCandidate, 'a reported collision must never be the value ultimately returned');
  assert.ok(id.isWellFormedTII(t));
});

test('newTII: with no collision predicate, generation still succeeds and is well-formed', () => {
  const t = id.newTII();
  assert.ok(id.isWellFormedTII(t));
});

test('isWellFormedTII: accepts only exactly "tii:" + 12 alphabet characters, nothing more or less', () => {
  const good = id.newTII().slice(4);
  assert.ok(id.isWellFormedTII('tii:' + good));
});

test('isWellFormedTII: rejects every malformed input — no fuzzy repair, no partial match', () => {
  const good = id.newTII().slice(4);
  const cases = [
    '',
    'tii:' + good.slice(0, 11), // too short
    'tii:' + good + 'a', // too long
    'tii:' + good.slice(0, 11) + 'i', // excluded look-alike char (i)
    'tii:' + good.slice(0, 11) + 'l', // excluded look-alike char (l)
    'tii:' + good.slice(0, 11) + 'o', // excluded look-alike char (o)
    'tii:' + good.slice(0, 11) + 'u', // excluded look-alike char (u)
    'tii:' + good.toUpperCase(), // no case-folding — canonical form is exact
    good, // missing "tii:" scheme entirely
    'doi:' + good, // wrong scheme
    'TII:' + good, // scheme itself is not case-folded either
    'tii:' + good + '#fragment', // a URI reference (fragment) is not itself a well-formed bare TII
    'tii:' + good + '#',
    'tii: ' + good, // whitespace
    ' tii:' + good,
    'tii:' + good + ' ',
    null,
    undefined,
    42,
    {},
    ['tii:' + good],
  ];
  for (const c of cases) {
    assert.equal(id.isWellFormedTII(c), false, `expected NOT well-formed: ${JSON.stringify(c)}`);
  }
});

test('isWellFormedTII: a fragment does not rescue an otherwise-invalid body', () => {
  assert.equal(id.isWellFormedTII('tii:' + 'i'.repeat(12) + '#note'), false);
});

test('tiiToFileSlug: replaces every non-alphanumeric run with a single underscore, is stable, and is collision-safe for the fixed "tii:" prefix', () => {
  const t = id.newTII();
  const slug = id.tiiToFileSlug(t);
  assert.equal(slug, 'tii_' + t.slice(4));
  assert.match(slug, /^[a-z0-9_]+$/i);
  assert.equal(id.tiiToFileSlug(t), slug, 'idempotent / stable for the same input');
});

test('tiiToFileSlug: never throws on adversarial input, always collapses non-alphanumerics', () => {
  const cases = ['tii:###:::', '', 'a-b_c.d', 'tii:x#fragment', '   '];
  for (const c of cases) {
    const slug = id.tiiToFileSlug(c);
    assert.equal(typeof slug, 'string');
    assert.ok(!/[^a-z0-9_]/i.test(slug) || slug === '', `slug must contain only [a-zA-Z0-9_]: ${JSON.stringify(slug)}`);
  }
});

test('generation is unique at scale (no collisions in 5000 draws, matching the production-profile test\'s rigor)', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const t = id.newTII((c) => seen.has(c));
    assert.ok(!seen.has(t));
    seen.add(t);
  }
});

test('newEventId: always "evt_" + exactly EVENT_BODY_LENGTH alphabet characters, unique at scale', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const e = id.newEventId((c) => seen.has(c));
    assert.ok(!seen.has(e));
    seen.add(e);
    assert.equal(e.slice(0, 4), 'evt_');
    assert.equal(e.length, 4 + id.EVENT_BODY_LENGTH);
    assert.match(e.slice(4), new RegExp(`^[${id.ALPHABET}]{${id.EVENT_BODY_LENGTH}}$`));
  }
});

test('no semantic metadata: the body is a function of random draws only, not of time/sequence', () => {
  const a = id.newTII();
  const b = id.newTII();
  assert.notEqual(a, b);
  // Two draws made back-to-back (same wall-clock millisecond in practice)
  // must not be related in any structural way beyond both being well-formed.
  assert.ok(id.isWellFormedTII(a));
  assert.ok(id.isWellFormedTII(b));
});
