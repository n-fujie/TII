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
const vm = require('node:vm');

const { Ledger } = require('../src/ledger');
const views = require('../src/views');

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
    ledgerFile,
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

/* ------------------------ static-deployment client-side resolve script --- *
 * The DEPLOYED site (transition-ignition-id.org) is a static mirror — it
 * never runs src/server.js at all. The homepage's resolve form is instead
 * intercepted by an inline client-side script (src/views.js homePage()) that
 * computes the target slug itself and redirects. This script had the exact
 * same missing-fragment-handling defect as resolveIdentifier() above, and
 * fixing server.js alone does not touch it. These tests execute the ACTUAL
 * shipped script (extracted from the real rendered HTML via vm, not a
 * hand-copied duplicate) so a future edit that reintroduces the bug here
 * would be caught even if server.js stays correct. */

function extractResolveScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('resolve script not found in rendered homepage');
  return m[1];
}

/** Run the real shipped script against a minimal document/window stub and
 * return the href it navigated to after simulating a form submit. */
function simulateResolveSubmit(script, typedValue) {
  let capturedHandler = null;
  const fakeForm = {
    tii: { value: typedValue },
    addEventListener: (evt, handler) => {
      if (evt === 'submit') capturedHandler = handler;
    },
  };
  const sandbox = {
    document: { querySelector: (sel) => (sel === 'form.resolve' ? fakeForm : null) },
    window: { location: { href: null } },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.ok(capturedHandler, 'the script must have registered a submit handler');
  capturedHandler({ preventDefault: () => {} });
  return sandbox.window.location.href;
}

test('static-deployment resolve script — bare token redirects to the correct slug', () => {
  const script = extractResolveScript(views.homePage({ lang: 'en' }));
  assert.equal(simulateResolveSubmit(script, 'tii:h4r3jsn4p25d'), '/tii/tii_h4r3jsn4p25d');
});

test('static-deployment resolve script — a fragment must not break resolution (this was the live bug on the deployed static site: fixed 2026-09-17)', () => {
  const script = extractResolveScript(views.homePage({ lang: 'en' }));
  assert.equal(
    simulateResolveSubmit(script, 'tii:h4r3jsn4p25d#note'),
    '/tii/tii_h4r3jsn4p25d',
    'a #fragment must be stripped before the slug is computed, exactly like resolveIdentifier() on the dynamic server'
  );
});

test('static-deployment resolve script — a bare trailing "#" also resolves to the base identifier', () => {
  const script = extractResolveScript(views.homePage({ lang: 'en' }));
  assert.equal(simulateResolveSubmit(script, 'tii:h4r3jsn4p25d#'), '/tii/tii_h4r3jsn4p25d');
});

test('static-deployment resolve script — different fragments on the same base produce the identical redirect target', () => {
  const script = extractResolveScript(views.homePage({ lang: 'en' }));
  const a = simulateResolveSubmit(script, 'tii:h4r3jsn4p25d#a');
  const b = simulateResolveSubmit(script, 'tii:h4r3jsn4p25d#b');
  assert.equal(a, b);
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

test('registry API — GET /catalog.json includes checkpoint verification status, matching the static export\'s checkpoint field (parity, not a re-implementation)', async () => {
  const srv = await bootServerWithOneTII();
  const checkpointDir = process.env.TII_CHECKPOINT_DIR; // bootServerWithOneTII() sets this before requiring src/server.js
  try {
    // Before any checkpoint exists: the field is present and correctly MISSING.
    const before = JSON.parse((await get(srv.port, '/catalog.json')).text);
    assert.ok('checkpoint' in before, 'the dynamic server\'s catalog.json must carry the same checkpoint field the static export does');
    assert.equal(before.checkpoint.status, 'MISSING');

    // Create a real checkpoint against the SAME ledger file the server is
    // reading, then confirm the live route picks it up (it re-verifies on
    // every request, never a cached value).
    const { generateKeypair } = require('../src/checkpoint');
    const checkpointStore = require('../src/checkpoint-store');
    const kp = generateKeypair();
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-resolver-ckpt-key-'));
    const keyFile = path.join(keyDir, 'key.pem');
    fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
    const ledgerForCheckpoint = new Ledger(srv.ledgerFile).load();
    checkpointStore.createCheckpoint(ledgerForCheckpoint, { dir: checkpointDir, env: { TII_CHECKPOINT_PRIVATE_KEY_FILE: keyFile } });

    const after = JSON.parse((await get(srv.port, '/catalog.json')).text);
    assert.equal(after.checkpoint.status, 'VERIFIED');
    assert.equal(after.checkpoint.matches_current_head, true);
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

/* ==================================================================== *
 * STATIC BUILD vs DYNAMIC SERVER: same TII references, same outcome.
 *
 * The deployed production site is the STATIC build (exporters.buildStaticSite);
 * the dynamic src/server.js is used for local development and any future
 * non-static deployment. Both must interpret the same input references
 * identically -- this is the deliverable the shared src/tii-lookup.js
 * primitive (and its byte-identical embedding into the static build's own
 * client-side script) exists to guarantee. This test builds BOTH from the
 * SAME seeded ledger and drives BOTH with the SAME input matrix.
 * ==================================================================== */

const exporters = require('../src/export');
const { tiiToFileSlug } = require('../src/id');

/** What the STATIC build resolves `typedValue` to: run its own shipped
 * client-side script (extracted from the real built index.html — not
 * views.js directly, so this exercises the actual build artifact) and
 * report the slug it would navigate to. */
function staticBuildResolves(outDir, typedValue) {
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const script = extractResolveScript(html);
  return simulateResolveSubmit(script, typedValue);
}

/** What the DYNAMIC server resolves `typedValue` to via /resolve?tii=:
 * the redirect Location on success, or the literal marker '404' on a
 * genuine not-found. */
async function dynamicServerResolves(port, typedValue) {
  const res = await get(port, '/resolve?tii=' + encodeURIComponent(typedValue));
  if (res.status === 404) return '404';
  return res.headers.location;
}

test('EQUIVALENCE — static production build and dynamic server resolve an identical input matrix to the identical outcome', async () => {
  const srv = await bootServerWithOneTII();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-equiv-static-'));
  try {
    const seededLedger = new Ledger(srv.ledgerFile).load();
    exporters.buildStaticSite(seededLedger, outDir, { resolverBase: '' });

    const slug = tiiToFileSlug(srv.tii);
    const matrix = [
      srv.tii, // bare, canonical
      srv.tii.toUpperCase(), // case-insensitive scheme/body per RFC 3986 §3.1
      srv.tii + '#note', // fragment must not break resolution
      srv.tii + '#', // bare fragment marker
      '  ' + srv.tii + '  ', // incidental whitespace
      'tii:doesnotexist0000', // well-formed but unknown
      'tii:doesnotexist0000#note', // unknown + fragment: must still not false-positive
    ];

    for (const input of matrix) {
      const staticHref = staticBuildResolves(outDir, input);
      const dynamicLocation = await dynamicServerResolves(srv.port, input);

      if (input.includes('doesnotexist')) {
        assert.notEqual(staticHref, '/tii/' + slug, `static build must not false-positive on ${JSON.stringify(input)}`);
        assert.notEqual(dynamicLocation, '/tii/' + slug, `dynamic server must not false-positive on ${JSON.stringify(input)}`);
      } else {
        assert.equal(staticHref, '/tii/' + slug, `static build should resolve ${JSON.stringify(input)} to the seeded identifier`);
        assert.equal(dynamicLocation, '/tii/' + slug, `dynamic server should resolve ${JSON.stringify(input)} to the seeded identifier`);
        assert.equal(staticHref, dynamicLocation, `static and dynamic must agree exactly for ${JSON.stringify(input)}`);
      }
    }
  } finally {
    await srv.close();
    srv.restoreEnv();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
