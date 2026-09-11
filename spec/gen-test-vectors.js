#!/usr/bin/env node
'use strict';

// Regenerate spec/test-vectors.json from the candidate reference implementation.
//   node spec/gen-test-vectors.js
// Deterministic parts use fixed byte inputs; the "example_identifiers" block is
// freshly generated and marked non-normative.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const id = require('../src/identifier');

const fixed = (hex) => Buffer.from(hex, 'hex');

const roundtrip = [
  { bytes_hex: '00000000000000000000000000000000', token: id.base32Encode(fixed('00000000000000000000000000000000')) },
  { bytes_hex: 'ffffffffffffffffffffffffffffffff', token: id.base32Encode(fixed('ffffffffffffffffffffffffffffffff')) },
  { bytes_hex: '000102030405060708090a0b0c0d0e0f', token: id.base32Encode(fixed('000102030405060708090a0b0c0d0e0f')) },
  { bytes_hex: 'deadbeefdeadbeefdeadbeefdeadbeef', token: id.base32Encode(fixed('deadbeefdeadbeefdeadbeefdeadbeef')) },
].map((v) => {
  const decoded = id.base32Decode(v.token).toString('hex');
  return { ...v, decodes_to_hex: decoded, roundtrips: decoded === v.bytes_hex, canonical_token: id.isCanonicalToken(v.token) };
});

const validCanonical = roundtrip.map((v) => `tii:${v.token}`);

const acceptedThenCanonicalized = [
  { input: `TII:${roundtrip[2].token}`, canonical: `tii:${roundtrip[2].token}` },
  { input: `tii:${roundtrip[2].token.toUpperCase()}`, canonical: `tii:${roundtrip[2].token}` },
  { input: `Tii:${roundtrip[2].token}`, canonical: `tii:${roundtrip[2].token}` },
];

const T = roundtrip[2].token; // a known-good 26-char token
const rejected = [
  { input: '', code: 'empty' },
  { input: T, code: 'missing-scheme' },
  { input: `doi:${T}`, code: 'bad-scheme' },
  { input: `urn:tii:${T}`, code: 'bad-scheme' },
  { input: `tii:${T.slice(0, 25)}`, code: 'bad-length', note: '25 chars' },
  { input: `tii:${T}a`, code: 'bad-length', note: '27 chars' },
  { input: `tii:${T.slice(0, 25)}0`, code: 'bad-char', note: 'digit 0 is NOT mapped to o' },
  { input: `tii:${T.slice(0, 25)}1`, code: 'bad-char', note: 'digit 1 is NOT mapped to i or l' },
  { input: `tii:${T.slice(0, 25)}8`, code: 'bad-char' },
  { input: `tii:${T.slice(0, 25)}9`, code: 'bad-char' },
  { input: `tii:${'a'.repeat(25)}b`, code: 'non-canonical-tail', note: 'non-zero trailing bits' },
  { input: `tii:${T}=`, code: 'padding' },
  { input: `tii:${T}====`, code: 'padding' },
  { input: ` tii:${T}`, code: 'whitespace' },
  { input: `tii:${T} `, code: 'whitespace' },
  { input: `tii:${T.slice(0, 13)}\t${T.slice(14)}`, code: 'whitespace' },
  { input: `tii:${T.slice(0, 25)}é`, code: 'non-ascii' },
  { input: `tii:${T.slice(0, 24)}ａｂ`, code: 'non-ascii', note: 'full-width latin' },
  { input: `tii:%41${T.slice(3)}`, code: 'percent-encoding' },
  { input: `tii://${T}`, code: 'authority' },
  { input: `tii:${T}/`, code: 'path' },
  { input: `tii:${T}/extra`, code: 'path' },
  { input: `tii:${T}?x=1`, code: 'query' },
  { input: `tii:${T}#frag`, code: 'has-fragment', note: 'a URI reference with a fragment — not a canonical TII; see uri_references' },
].map((c) => {
  let got;
  try {
    id.parseCanonicalTII(c.input);
    got = 'NO-THROW';
  } catch (e) {
    got = e.code || e.name;
  }
  return { ...c, actual_code: got, matches: got === c.code };
});

// RFC 3986 URI references: the fragment is separated BEFORE TII processing and
// does not affect the token or registry lookup.
const T2 = roundtrip[0].token; // 26 'a's
const uriReferences = [
  { input: `tii:${T}#section-3`, tii: `tii:${T}`, fragment: 'section-3' },
  { input: `tii:${T2}#`, tii: `tii:${T2}`, fragment: '' },
  { input: `tii:${T}#a#b`, tii: `tii:${T}`, fragment: 'a#b' },
  { input: `tii:${T}`, tii: `tii:${T}`, fragment: null },
  { input: `TII:${T.toUpperCase()}#X`, tii: `tii:${T}`, fragment: 'X' },
].map((c) => {
  const r = id.parseTIIReference(c.input);
  return {
    ...c,
    parsed_tii: r.tii,
    parsed_fragment: r.fragment,
    parseCanonicalTII_rejects_with: (() => {
      try { id.parseCanonicalTII(c.input); return 'NO-THROW'; } catch (e) { return e.code; }
    })(),
    canonicalize_result: id.canonicalize(c.input),
    resolution_url: id.resolutionUrl('https://resolver.example', c.input),
    matches: r.tii === c.tii && r.fragment === c.fragment && id.canonicalize(c.input) === c.tii,
  };
});

const out = {
  $comment:
    'Machine-readable test vectors for the CANDIDATE TII identifier syntax. ' +
    'Regenerate with `node spec/gen-test-vectors.js`. Not final until the freeze audit is accepted.',
  profile: {
    scheme: id.SCHEME,
    entropy_bits: id.ENTROPY_BYTES * 8,
    token_length: id.TOKEN_LENGTH,
    alphabet: id.ALPHABET,
    valid_final_characters: [...id.LAST_CHAR_SET].sort(),
    padding: false,
    case: 'lowercase canonical; uppercase Base32 input accepted and normalised',
  },
  base32_roundtrip: roundtrip,
  valid_canonical_identifiers: validCanonical,
  accepted_then_canonicalized: acceptedThenCanonicalized,
  uri_references: uriReferences,
  rejected_inputs: rejected,
  resolution_urls_are_separate: {
    identifier: validCanonical[2],
    token: roundtrip[2].token,
    resolution_url_example_a: id.resolutionUrl('https://resolver.example', validCanonical[2]),
    resolution_url_example_b: id.resolutionUrl('https://another-host.test/', roundtrip[2].token),
    note: 'Changing the resolver base does not change the identifier or the token.',
  },
  example_identifiers_non_normative: Array.from({ length: 3 }, () => id.generateIdentifier()),
  all_rejections_match: rejected.every((r) => r.matches),
  all_uri_references_match: uriReferences.every((r) => r.matches),
  all_roundtrips_ok: roundtrip.every((r) => r.roundtrips && r.canonical_token),
};

const file = path.join(__dirname, 'test-vectors.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', file);
console.log(
  'roundtrips ok:', out.all_roundtrips_ok,
  '| rejections match:', out.all_rejections_match,
  '| uri-references match:', out.all_uri_references_match
);
if (!out.all_roundtrips_ok || !out.all_rejections_match || !out.all_uri_references_match) process.exit(1);
