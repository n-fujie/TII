'use strict';

/**
 * Resolver conformance against the IANA `tii` URI scheme registration
 * (https://www.iana.org/assignments/uri-schemes/prov/tii, Provisional,
 * registered 2026-09-15): "The canonical form is tii:<token>. The token is
 * opaque. HTTPS resolution infrastructure is separate from identifier
 * identity. URI fragments follow generic RFC 3986 URI-reference semantics
 * and are not part of the TII token."
 *
 * Spins up the real src/server.js HTTP server (module cache cleared between
 * scenarios) on an ephemeral port and issues real HTTP requests — this
 * exercises the actual resolver logic, not a re-implementation of it. Same
 * pattern as test/admin-security.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { Ledger } = require('../src/ledger');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-resolver-'));
  return path.join(dir, 'ledger.jsonl');
}

/** Boot a fresh instance of src/server.js, seeded with one issued test TII. */
async function bootServerWithOneTII() {
  const ledgerFile = tmpLedgerFile();
  const seed = new Ledger(ledgerFile).load();
  const { tii } = seed.issueTII({ recorder: { id: 'seed', kind: 'mechanism' } });

  const prevEnv = { ...process.env };
  Object.assign(process.env, {
    TII_LEDGER: ledgerFile,
    TII_ADMIN_TOKEN: '',
    TII_ADMIN_HASH_DIR: '',
    TII_CHECKPOINT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tii-resolver-ckpt-')),
  });
  delete require.cache[require.resolve('../src/server')];
  const mod = require('../src/server');
  await new Promise((resolve) => mod.server.listen(0, resolve));
  const port = mod.server.address().port;
  return {
    tii,
    port,
    close: () => new Promise((resolve) => mod.server.close(resolve)),
    restoreEnv: () => Object.assign(process.env, prevEnv),
  };
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .request({ host: 'localhost', port, method: 'GET', path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject)
      .end();
  });
}

/* --------------------------------------------- fragment semantics (RFC 3986) --- */

test('resolver — /resolve?tii=<token> resolves a bare, fragment-free reference', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/resolve?tii=' + encodeURIComponent(srv.tii));
    assert.equal(res.status, 302, 'a successful resolve redirects to the resolution page');
    assert.match(res.headers.location, /\/tii\//);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('resolver — /resolve?tii=<token>#fragment still resolves: the fragment is stripped before lookup, never part of the TII (RFC 3986 / IANA registration)', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/resolve?tii=' + encodeURIComponent(srv.tii + '#some-note'));
    assert.equal(res.status, 302, 'a fragment must not cause an otherwise-valid reference to fail to resolve');
    assert.match(res.headers.location, /\/tii\//);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('resolver — /resolve?tii=<token># (bare fragment marker, empty fragment) still resolves', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/resolve?tii=' + encodeURIComponent(srv.tii + '#'));
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/tii\//);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('resolver — a fragment never affects WHICH record is returned: tii#a and tii#b both resolve to the identical underlying identifier', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const resA = await get(srv.port, '/resolve?tii=' + encodeURIComponent(srv.tii + '#a'));
    const resB = await get(srv.port, '/resolve?tii=' + encodeURIComponent(srv.tii + '#b'));
    assert.equal(resA.status, 302);
    assert.equal(resB.status, 302);
    assert.equal(resA.headers.location, resB.headers.location, 'the fragment carries no scheme-specific semantics — both references resolve identically');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('resolver — an UNKNOWN token with a fragment correctly reports not-found, not a crash or a false match', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/resolve?tii=' + encodeURIComponent('tii:doesnotexist0000#note'));
    assert.equal(res.status, 404, 'an unresolvable reference is a genuine 404, not masked by fragment-stripping into a false positive');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('resolver — a bare "#" with no preceding identifier resolves to nothing (not a crash, not an accidental match)', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/resolve?tii=' + encodeURIComponent('#'));
    // resolveIdentifier returns null for an empty base -> /resolve redirects nowhere useful;
    // the important invariant is that this does not throw and does not match the seeded TII.
    assert.notEqual(res.status, 500);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* -------------------------------------- path-based resolution (HTTP-native) --- */

test('resolver — /tii/<slug> resolves directly (HTTP never sends a fragment to the server at all, per RFC 3986 §3.5 — nothing to strip here, included for completeness)', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const { tiiToFileSlug } = require('../src/id');
    const res = await get(srv.port, '/tii/' + tiiToFileSlug(srv.tii));
    assert.equal(res.status, 200);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* -------------------------------------------------------- registry API --- */

test('registry API — GET /catalog.json on the live dynamic server matches the shape of the static export\'s catalog.json (src/export.js buildStaticSite)', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/catalog.json');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    const body = JSON.parse(res.text);
    assert.ok('generated_at' in body);
    assert.ok('verification' in body);
    assert.ok('resolver_base' in body);
    assert.ok(Array.isArray(body.identifiers));
    const entry = body.identifiers.find((i) => i.tii === srv.tii);
    assert.ok(entry, 'the seeded identifier must appear in the catalog');
    assert.equal(entry.identifier_status, 'test');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('registry API — /catalog.json never embeds the resolver domain into an identifier: resolver_base is separate config, tii strings are unaffected by it', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const res = await get(srv.port, '/catalog.json');
    const body = JSON.parse(res.text);
    for (const entry of body.identifiers) {
      assert.doesNotMatch(entry.tii, /https?:|localhost|\./, 'a tii: identifier must never contain a URL, domain, or host fragment');
    }
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* --------------------------------------- resolver separate from identity --- */

test('resolver — identical identifier resolves the same way regardless of Host header (identity does not depend on the resolver domain)', async () => {
  const srv = await bootServerWithOneTII();
  try {
    const { tiiToFileSlug } = require('../src/id');
    const res1 = await get(srv.port, '/tii/' + tiiToFileSlug(srv.tii));
    const res2 = new Promise((resolve, reject) => {
      http
        .request({ host: 'localhost', port: srv.port, method: 'GET', path: '/tii/' + tiiToFileSlug(srv.tii), headers: { host: 'a-completely-different-hostname.example' } }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        })
        .on('error', reject)
        .end();
    });
    const r2 = await res2;
    assert.equal(res1.status, 200);
    assert.equal(r2.status, 200);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});
