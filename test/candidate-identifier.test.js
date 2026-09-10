'use strict';

/**
 * Tests for the CANDIDATE production identifier profile (src/candidate/identifier.js).
 * Production issuance is NOT enabled by these tests — they only exercise the
 * candidate module in isolation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const id = require('../src/candidate/identifier');

test('entropy: a token decodes to exactly 128 bits (16 bytes)', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = id.base32Decode(id.generateToken());
    assert.equal(bytes.length, 16);
  }
});

test('token length is exactly 26 and the identifier is "tii:" + token', () => {
  const s = id.generateIdentifier();
  assert.match(s, /^tii:[a-z2-7]{26}$/);
  assert.equal(s.length, 4 + 26);
});

test('alphabet: only a-z 2-7 — never 0 1 8 9, never padding', () => {
  for (let i = 0; i < 1000; i++) {
    const tok = id.generateToken();
    assert.match(tok, /^[a-z2-7]{26}$/);
    assert.ok(!/[018 9=]/.test(tok));
  }
});

test('generation is canonical and unique at scale', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const tok = id.generateToken();
    assert.ok(id.isCanonicalToken(tok), `canonical: ${tok}`);
    assert.ok(!seen.has(tok), 'collision within 5000 draws (must not happen)');
    seen.add(tok);
  }
});

test('the final character is always one of the 8 valid Base32 tail symbols', () => {
  const tail = new Set();
  for (let i = 0; i < 3000; i++) tail.add(id.generateToken()[25]);
  for (const c of tail) assert.ok(id.LAST_CHAR_SET.has(c), `unexpected tail char ${c}`);
  assert.ok([...tail].every((c) => 'aeimquy4'.includes(c)));
});

test('no semantic metadata: token is a function of 16 random bytes only', () => {
  // Same clock, different tokens; and the token round-trips its exact bytes.
  const a = id.generateToken();
  const b = id.generateToken();
  assert.notEqual(a, b);
  const bytes = require('node:crypto').randomBytes(16);
  assert.deepEqual(id.base32Decode(id.base32Encode(bytes)), bytes);
});

test('Base32 round-trips known vectors exactly', () => {
  // The normative subset published in identifier-syntax-1.0-candidate.md §4.1
  const NORMATIVE = {
    '00000000000000000000000000000000': 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
    ffffffffffffffffffffffffffffffff: '77777777777777777777777774',
    '000102030405060708090a0b0c0d0e0f': 'aaaqeayeaudaocajbifqydiob4',
    deadbeefdeadbeefdeadbeefdeadbeef: '32w35366vw7o7xvnx3x55ln654',
  };
  for (const [hex, token] of Object.entries(NORMATIVE)) {
    assert.equal(id.base32Encode(Buffer.from(hex, 'hex')), token);
    assert.equal(id.base32Decode(token).toString('hex'), hex);
  }

  const zero = Buffer.alloc(16, 0);
  assert.equal(id.base32Encode(zero), 'a'.repeat(26));
  assert.deepEqual(id.base32Decode('a'.repeat(26)), zero);

  const ones = Buffer.alloc(16, 0xff);
  const enc = id.base32Encode(ones);
  assert.equal(enc, '7'.repeat(25) + '4');
  assert.deepEqual(id.base32Decode(enc), ones);

  for (let i = 0; i < 500; i++) {
    const r = require('node:crypto').randomBytes(16);
    assert.deepEqual(id.base32Decode(id.base32Encode(r)), r);
  }
});

test('canonicalize: uppercase scheme and token normalize to lowercase', () => {
  const tok = id.generateToken();
  assert.equal(id.canonicalize('TII:' + tok), 'tii:' + tok);
  assert.equal(id.canonicalize('tii:' + tok.toUpperCase()), 'tii:' + tok);
  assert.equal(id.canonicalize('Tii:' + tok), 'tii:' + tok);
});

test('there is exactly one canonical form (idempotent)', () => {
  const s = id.generateIdentifier();
  assert.equal(id.canonicalize(s), s);
  assert.equal(id.canonicalize(id.canonicalize(s)), s);
});

test('parse rejects every malformed input with a stable code — no fuzzy repair', () => {
  const good = id.generateToken();
  const cases = [
    ['', 'empty'],
    ['tii:' + good.slice(0, 25), 'bad-length'],
    ['tii:' + good + 'a', 'bad-length'],
    ['tii:' + good.slice(0, 25) + '0', 'bad-char'], // 0 is NOT mapped to o
    ['tii:' + good.slice(0, 25) + '1', 'bad-char'], // 1 is NOT mapped to i/l
    ['tii:' + good.slice(0, 25) + '8', 'bad-char'],
    ['tii:' + good + '=', 'padding'],
    [' tii:' + good, 'whitespace'],
    ['tii:' + good + ' ', 'whitespace'],
    ['tii:' + good.slice(0, 13) + ' ' + good.slice(14), 'whitespace'],
    ['tii:' + good.slice(0, 25) + 'é', 'non-ascii'],
    ['tii:%41' + good.slice(3), 'percent-encoding'],
    ['tii://' + good, 'authority'],
    ['tii:' + good + '/', 'path'],
    ['tii:' + good + '?x=1', 'query'],
    ['tii:' + good + '#f', 'fragment'],
    [good, 'missing-scheme'],
    ['doi:' + good, 'bad-scheme'],
    ['urn:tii:' + good, 'bad-scheme'],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => id.parse(input),
      (e) => e instanceof id.TiiSyntaxError && e.code === code,
      `${JSON.stringify(input)} should throw ${code}, got ${(() => { try { id.parse(input); return 'no throw'; } catch (e) { return e.code; } })()}`
    );
  }
});

test('non-canonical Base32 tail (non-zero trailing bits) is rejected', () => {
  // 'b' as the 26th symbol => low 2 bits set => not a canonical 128-bit encoding
  const bad = 'a'.repeat(25) + 'b';
  assert.throws(() => id.base32Decode(bad), (e) => e.code === 'non-canonical-tail');
  assert.ok(!id.isCanonicalToken(bad));
  assert.throws(() => id.parse('tii:' + bad), (e) => e.code === 'non-canonical-tail');
});

test('issuance discards a collided candidate and never records it', () => {
  const issued = new Set();
  const first = id.issueIdentifier((x) => issued.has(x));
  issued.add(first);

  let calls = 0;
  const exists = (x) => {
    calls++;
    return calls === 1 ? true : issued.has(x); // force one collision then accept
  };
  const second = id.issueIdentifier(exists);
  assert.notEqual(second, first);
  assert.ok(calls >= 2, 'a collided candidate was discarded and a new one drawn');
});

test('resolver and identifier are separate: changing the base never changes the token', () => {
  const s = id.generateIdentifier();
  const token = id.parse(s).token;
  const a = id.resolutionUrl('https://example.org', s);
  const b = id.resolutionUrl('https://tii.somewhere-else.test/', token);
  assert.equal(a, 'https://example.org/tii/' + token);
  assert.equal(b, 'https://tii.somewhere-else.test/tii/' + token);
  assert.equal(id.parse(s).token, token); // unchanged
});

test('no hosting-provider hostname can appear in a canonical identifier', () => {
  const s = id.generateIdentifier();
  assert.ok(!s.includes('.'), 'no dots — cannot contain a hostname');
  assert.ok(!/vercel|http|\/\//.test(s));
});

test('the candidate module uses only CSPRNG — no Math.random anywhere', () => {
  for (const f of ['identifier.js', 'checkpoint.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'candidate', f), 'utf8');
    assert.ok(!/Math\.random/.test(src), `${f} must not reference Math.random`);
  }
});

test('spec/test-vectors.json matches the reference implementation', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec', 'test-vectors.json'), 'utf8'));
  assert.equal(v.profile.scheme, id.SCHEME);
  assert.equal(v.profile.entropy_bits, id.ENTROPY_BYTES * 8);
  assert.equal(v.profile.token_length, id.TOKEN_LENGTH);
  for (const rt of v.base32_roundtrip) {
    assert.equal(id.base32Decode(rt.token).toString('hex'), rt.bytes_hex);
    assert.equal(id.base32Encode(Buffer.from(rt.bytes_hex, 'hex')), rt.token);
  }
  for (const s of v.valid_canonical_identifiers) assert.equal(id.canonicalize(s), s);
  for (const c of v.accepted_then_canonicalized) assert.equal(id.canonicalize(c.input), c.canonical);
  for (const r of v.rejected_inputs) {
    assert.throws(
      () => id.parse(r.input),
      (e) => e.code === r.code,
      `${JSON.stringify(r.input)} expected code ${r.code}`
    );
  }
});

test('candidate module is not wired into the running system', () => {
  for (const f of ['id.js', 'ledger.js', 'server.js', 'export.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    assert.ok(!/candidate\//.test(src), `src/${f} must not import src/candidate/*`);
  }
  const cli = fs.readFileSync(path.join(__dirname, '..', 'bin', 'tii.js'), 'utf8');
  assert.ok(!/candidate\//.test(cli));
});
