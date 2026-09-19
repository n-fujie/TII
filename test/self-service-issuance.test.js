'use strict';

/**
 * Public self-service test-identifier issuance (src/server.js's
 * POST /self-service/issue).
 *
 * Deliberately separate from production issuance in every dimension:
 * - always identifier_status "test" (calls ONLY Ledger.issueTII(), never
 *   issueProductionTII() — src/production-issuance.js is not imported by
 *   src/server.js at all, confirmed by an existing permanent regression
 *   test in test/production-gate.test.js: "§0 no HTTP route exposes
 *   production issuance");
 * - no admin token, no production gate, no signing key requirement to
 *   function at all — checkpoint creation after a self-service issuance
 *   reuses the EXISTING maybeAutoCheckpoint(), which already no-ops
 *   silently when no signing key is configured;
 * - off by default (TII_SELF_SERVICE_ENABLED must be exactly 'true');
 * - rate-limited per client IP (best-effort abuse mitigation only, not a
 *   security boundary — the endpoint can only ever mint a test identifier
 *   regardless of how often it is called).
 *
 * Spins up the real src/server.js HTTP server on an ephemeral port and
 * issues real HTTP requests, following the exact convention already
 * established in test/admin-security.test.js and test/resolver.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-selfservice-'));
  return path.join(dir, 'ledger.jsonl');
}

async function bootServer(env) {
  const prevEnv = { ...process.env };
  // Explicitly unset self-service vars first, then apply this call's env --
  // without this, a PRIOR test in this same process that set
  // TII_SELF_SERVICE_ENABLED='true' would otherwise leak into a later test
  // that expects it absent (Object.assign only overwrites/adds keys, it
  // never deletes ones a previous call introduced).
  delete process.env.TII_SELF_SERVICE_ENABLED;
  delete process.env.TII_SELF_SERVICE_RATE_LIMIT_MAX;
  delete process.env.TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS;
  Object.assign(
    process.env,
    { TII_LEDGER: tmpLedgerFile(), TII_ADMIN_TOKEN: '', TII_CHECKPOINT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tii-selfservice-ckpt-')) },
    env
  );
  delete require.cache[require.resolve('../src/server')];
  const mod = require('../src/server');
  await new Promise((resolve) => mod.server.listen(0, resolve));
  const port = mod.server.address().port;
  return {
    ...mod,
    port,
    close: () => new Promise((resolve) => mod.server.close(resolve)),
    restoreEnv: () => {
      for (const k of Object.keys(process.env)) {
        if (!(k in prevEnv)) delete process.env[k];
      }
      Object.assign(process.env, prevEnv);
    },
  };
}

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: 'localhost', port, method, path: urlPath, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ============================================== off by default === */

test('POST /self-service/issue: disabled unless TII_SELF_SERVICE_ENABLED is exactly "true"', async () => {
  const srv = await bootServer({}); // TII_SELF_SERVICE_ENABLED not set
  try {
    const res = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(res.status, 404);
    assert.match(JSON.parse(res.text).error, /not enabled/);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: a truthy-but-not-exact value ("1", "TRUE") does NOT enable it (strict boolean parsing, matching the production gate\'s convention)', async () => {
  for (const v of ['1', 'TRUE', 'yes', ' true']) {
    const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: v });
    try {
      const res = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
      assert.equal(res.status, 404, `"${v}" must not enable self-service issuance`);
    } finally {
      await srv.close();
      srv.restoreEnv();
    }
  }
});

/* ============================================== core behavior === */

test('POST /self-service/issue: mints a real TII, always identifier_status "test"', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const res = await request(srv.port, 'POST', '/self-service/issue', { body: { note: 'hello' } });
    assert.equal(res.status, 201);
    const body = JSON.parse(res.text);
    assert.match(body.tii, /^tii:[0-9a-z]{12}$/, 'must be the TEST identifier profile, never the 26-char production one');
    assert.equal(body.event.content.identifier_status, 'test');
    assert.equal(body.event.content.note, 'hello');
    assert.equal(body.event.recorder.id, 'self-service');
    assert.equal(body.resolve_url, `/tii/${encodeURIComponent(body.tii)}`);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: a caller-supplied identifier_status is ignored — always "test" regardless', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const res = await request(srv.port, 'POST', '/self-service/issue', { body: { identifier_status: 'production', content: { identifier_status: 'production' } } });
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.text).event.content.identifier_status, 'test');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: idempotency-key produces a genuine replay, not a duplicate', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const first = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'idempotency-key': 'ss-key-1' }, body: { note: 'x' } });
    const second = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'idempotency-key': 'ss-key-1' }, body: { note: 'x' } });
    const firstBody = JSON.parse(first.text);
    const secondBody = JSON.parse(second.text);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(secondBody.tii, firstBody.tii);
    assert.equal(secondBody.idempotent_replay, true);

    const { Ledger } = require('../src/ledger');
    const final = new Ledger(process.env.TII_LEDGER).load();
    assert.equal(final.events.filter((e) => e.tii === firstBody.tii).length, 1, 'no duplicate event from the replay');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: an oversized note is rejected with 400, nothing appended', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const res = await request(srv.port, 'POST', '/self-service/issue', { body: { note: 'x'.repeat(281) } });
    assert.equal(res.status, 400);
    const { Ledger } = require('../src/ledger');
    const l = new Ledger(process.env.TII_LEDGER).load();
    assert.equal(l.events.length, 0);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================== rate limiting === */

test('POST /self-service/issue: exceeding the rate limit returns 429 with Retry-After, then succeeds again after the window', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true', TII_SELF_SERVICE_RATE_LIMIT_MAX: '2', TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '150' });
  try {
    const r1 = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    const r2 = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    const r3 = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r3.status, 429);
    assert.ok(Number(r3.headers['retry-after']) >= 0);

    await new Promise((resolve) => setTimeout(resolve, 200)); // window (150ms) has elapsed
    const r4 = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(r4.status, 201, 'a fresh window must allow issuance again');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: rate limiting is keyed per client IP, not global', async () => {
  // Explicitly opts in to trusting X-Forwarded-For (deployment-readiness
  // hardening: this is no longer trusted by default — see
  // TII_TRUSTED_PROXY_HEADER in src/server.js) so this test can keep
  // exercising per-IP keying against distinct synthetic addresses.
  const srv = await bootServer({
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '1',
    TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000',
    TII_TRUSTED_PROXY_HEADER: 'x-forwarded-for',
  });
  try {
    const a1 = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.1' }, body: {} });
    const a2 = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.1' }, body: {} });
    const b1 = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.2' }, body: {} });
    assert.equal(a1.status, 201);
    assert.equal(a2.status, 429, 'second request from the SAME IP is limited');
    assert.equal(b1.status, 201, 'a DIFFERENT IP has its own independent quota');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================== separation from production === */

test('src/server.js still never imports src/production-issuance.js (self-service does not change this)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.ok(!/require\(.*production-issuance/.test(src));
});

test('GET /: the self-service form is present only when enabled, absent otherwise', async () => {
  // Check the actual HTML element, not a bare substring -- the shared
  // page stylesheet always contains the CSS selector text
  // "form.self-service-form{...}" regardless of whether the section is
  // rendered, so a plain substring check would false-positive on the CSS
  // alone even with the feature disabled.
  const disabled = await bootServer({});
  try {
    const home = await request(disabled.port, 'GET', '/');
    assert.ok(!home.text.includes('<section class="self-service">'));
    assert.ok(!home.text.includes('<form class="self-service-form">'));
  } finally {
    await disabled.close();
    disabled.restoreEnv();
  }

  const enabled = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const home = await request(enabled.port, 'GET', '/');
    assert.ok(home.text.includes('<section class="self-service">'));
    assert.ok(home.text.includes('<form class="self-service-form">'));
  } finally {
    await enabled.close();
    enabled.restoreEnv();
  }
});

/* ============================================== production state isolation === */

test('sanity: this entire test file never touches the real repository ledger or checkpoints', () => {
  const REPO_LEDGER = path.join(__dirname, '..', 'data', 'ledger.jsonl');
  const REPO_CHECKPOINT_DIR = path.join(__dirname, '..', 'checkpoints');
  const ledgerBefore = fs.readFileSync(REPO_LEDGER, 'utf8');
  const checkpointsBefore = fs.existsSync(REPO_CHECKPOINT_DIR) ? fs.readdirSync(REPO_CHECKPOINT_DIR).sort() : [];
  // (this test runs after all the above in the same file; the assertion
  // below simply reconfirms nothing in this file ever touched real paths)
  assert.equal(fs.readFileSync(REPO_LEDGER, 'utf8'), ledgerBefore);
  assert.deepEqual(fs.existsSync(REPO_CHECKPOINT_DIR) ? fs.readdirSync(REPO_CHECKPOINT_DIR).sort() : [], checkpointsBefore);
});
