'use strict';

/**
 * Deployment-readiness hardening for a public, unauthenticated TEST
 * self-service deployment (TII_DEPLOYMENT_MODE=public-self-service in
 * src/server.js). This closes concrete code-level deployment gaps on top of
 * the opt-in self-service issuance feature (test/self-service-issuance.test.js)
 * without provisioning any actual infrastructure.
 *
 * Core invariant under test throughout this file: a public TEST deployment
 * must be incapable, by default and by configuration shape, of issuing
 * production identifiers, modifying the historical production ledger,
 * reading or signing production checkpoints, loading production signing
 * material, or satisfying the production gate. Every test either boots the
 * real src/server.js against disposable state (module cache cleared between
 * scenarios, same convention as test/self-service-issuance.test.js and
 * test/resolver.test.js) or asserts against require()'s own startup-time
 * failure.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { generateKeypair } = require('../src/checkpoint');

const REPO_ROOT = path.join(__dirname, '..');
const REPO_DEFAULT_LEDGER_FILE = path.join(REPO_ROOT, 'data', 'ledger.jsonl');
const REPO_DEFAULT_CHECKPOINT_DIR = path.join(REPO_ROOT, 'checkpoints');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-deployready-'));
  return path.join(dir, 'ledger.jsonl');
}

function tmpCheckpointDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tii-deployready-ckpt-'));
}

const MANAGED_ENV_KEYS = [
  'TII_SELF_SERVICE_ENABLED',
  'TII_SELF_SERVICE_RATE_LIMIT_MAX',
  'TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS',
  'TII_SELF_SERVICE_GLOBAL_QUOTA_MAX',
  'TII_SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS',
  'TII_SELF_SERVICE_MAX_LEDGER_BYTES',
  'TII_SELF_SERVICE_MAX_EVENT_COUNT',
  'TII_DEPLOYMENT_MODE',
  'TII_TRUSTED_PROXY_HEADER',
  'TII_REGISTRY_LABEL',
  'TII_CHECKPOINT_PRIVATE_KEY',
  'TII_CHECKPOINT_PRIVATE_KEY_FILE',
  'TII_ADMIN_TOKEN',
  'TII_ADMIN_HASH_DIR',
];

/** Boot a fresh src/server.js instance with the given env overlay. Does NOT
 * start listening or throw on a startup failure — callers that expect a
 * startup-time rejection call requireOnly() instead. */
function freshEnv(env) {
  const prevEnv = { ...process.env };
  for (const k of MANAGED_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/server')];
  return {
    restoreEnv: () => {
      for (const k of Object.keys(process.env)) {
        if (!(k in prevEnv)) delete process.env[k];
      }
      Object.assign(process.env, prevEnv);
      delete require.cache[require.resolve('../src/server')];
    },
  };
}

async function bootServer(env) {
  const handle = freshEnv({ TII_LEDGER: tmpLedgerFile(), TII_ADMIN_TOKEN: '', TII_CHECKPOINT_DIR: tmpCheckpointDir(), ...env });
  const mod = require('../src/server');
  await new Promise((resolve) => mod.server.listen(0, resolve));
  const port = mod.server.address().port;
  return {
    ...mod,
    port,
    close: () => new Promise((resolve) => mod.server.close(resolve)),
    restoreEnv: handle.restoreEnv,
  };
}

function request(port, method, urlPath, { headers = {}, body, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const data = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: 'localhost',
        port,
        method,
        path: urlPath,
        headers: { ...(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/* ================================================== Phase 2/4: deployment mode + ledger path === */

test('public-self-service mode: missing TII_LEDGER fails startup closed', () => {
  const handle = freshEnv({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_CHECKPOINT_DIR: tmpCheckpointDir() });
  try {
    assert.throws(() => require('../src/server'), /TII_LEDGER/);
  } finally {
    handle.restoreEnv();
  }
});

test('public-self-service mode: explicit disposable TEST ledger path succeeds', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service' });
  try {
    assert.equal(srv.ledger.events.length, 0);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('public-self-service mode: the canonical production ledger path is rejected', () => {
  const handle = freshEnv({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_LEDGER: REPO_DEFAULT_LEDGER_FILE,
    TII_CHECKPOINT_DIR: tmpCheckpointDir(),
  });
  try {
    assert.throws(() => require('../src/server'), /repository default ledger/);
  } finally {
    handle.restoreEnv();
  }
});

test('public-self-service mode: a relative path resolving to the production ledger is also rejected', () => {
  const relative = path.relative(process.cwd(), REPO_DEFAULT_LEDGER_FILE);
  const handle = freshEnv({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_LEDGER: relative,
    TII_CHECKPOINT_DIR: tmpCheckpointDir(),
  });
  try {
    assert.throws(() => require('../src/server'), /repository default ledger/);
  } finally {
    handle.restoreEnv();
  }
});

test('public-self-service mode: a symlink resolving to the production ledger is rejected (realpath, not lexical, comparison)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-deployready-symlink-'));
  const linkPath = path.join(dir, 'ledger.jsonl');
  try {
    fs.symlinkSync(REPO_DEFAULT_LEDGER_FILE, linkPath);
  } catch (e) {
    // Symlink creation can be restricted on some CI/sandboxed hosts --
    // skip rather than fail the whole suite over an environment limitation
    // unrelated to the behavior under test.
    return;
  }
  const handle = freshEnv({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_LEDGER: linkPath,
    TII_CHECKPOINT_DIR: tmpCheckpointDir(),
  });
  try {
    assert.throws(() => require('../src/server'), /repository default ledger/);
  } finally {
    handle.restoreEnv();
  }
});

test('default (non-self-service) deployment mode: an explicit disposable ledger path still boots normally (backward compatible)', async () => {
  const srv = await bootServer({});
  try {
    assert.equal(srv.ledger.events.length, 0);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ======================================================== Phase 3: checkpoint separation === */

test('public-self-service mode: missing TII_CHECKPOINT_DIR fails startup closed', () => {
  const handle = freshEnv({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_LEDGER: tmpLedgerFile() });
  try {
    assert.throws(() => require('../src/server'), /TII_CHECKPOINT_DIR/);
  } finally {
    handle.restoreEnv();
  }
});

test('public-self-service mode: the canonical production checkpoint directory is rejected', () => {
  const handle = freshEnv({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_LEDGER: tmpLedgerFile(),
    TII_CHECKPOINT_DIR: REPO_DEFAULT_CHECKPOINT_DIR,
  });
  try {
    assert.throws(() => require('../src/server'), /repository default checkpoint directory/);
  } finally {
    handle.restoreEnv();
  }
});

test('public-self-service mode: checkpoint signing never fires even when a valid signing key is configured', async () => {
  const kp = generateKeypair();
  const ckptDir = tmpCheckpointDir();
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_CHECKPOINT_DIR: ckptDir,
    TII_CHECKPOINT_PRIVATE_KEY: kp.privateKeyPem,
    TII_SELF_SERVICE_ENABLED: 'true',
  });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(r.status, 201);
    const files = fs.readdirSync(ckptDir);
    assert.ok(!files.some((f) => f.startsWith('checkpoint-')), 'no checkpoint file was ever written, despite a valid key being configured');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================================= Phase 5: trusted client IP === */

test('default deployment: X-Forwarded-For is NOT trusted -- spoofing a different IP does not bypass the per-IP limit', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true', TII_SELF_SERVICE_RATE_LIMIT_MAX: '1', TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000' });
  try {
    const a = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.1' }, body: {} });
    const b = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.2' }, body: {} });
    assert.equal(a.status, 201);
    assert.equal(b.status, 429, 'both requests share the same (real socket) identity by default, regardless of the spoofed header');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('TII_TRUSTED_PROXY_HEADER rejects a header name outside the allowlist', () => {
  const handle = freshEnv({ TII_TRUSTED_PROXY_HEADER: 'x-something-else' });
  try {
    assert.throws(() => require('../src/server'), /not one of the supported header names/);
  } finally {
    handle.restoreEnv();
  }
});

test('TII_TRUSTED_PROXY_HEADER=x-forwarded-for: a single well-formed value is trusted and keys per-IP correctly', async () => {
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
    assert.equal(a2.status, 429);
    assert.equal(b1.status, 201);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('TII_TRUSTED_PROXY_HEADER=x-forwarded-for: a malformed multi-value header falls back to the socket address, not the client-supplied first hop', async () => {
  const srv = await bootServer({
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '1',
    TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000',
    TII_TRUSTED_PROXY_HEADER: 'x-forwarded-for',
  });
  try {
    const a = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.1, 203.0.113.9' }, body: {} });
    const b = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.2, 203.0.113.9' }, body: {} });
    assert.equal(a.status, 201);
    assert.equal(b.status, 429, 'both malformed multi-value headers fall back to the same socket address');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ======================================================================= Phase 6: body limit === */

test('POST /self-service/issue: a normal small body succeeds', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', { body: { note: 'a small note' } });
    assert.equal(r.status, 201);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: an oversized body (> 2KB) is rejected with 413 and creates no ledger event', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const before = srv.ledger.events.length;
    const oversized = 'x'.repeat(3000);
    const r = await request(srv.port, 'POST', '/self-service/issue', { rawBody: JSON.stringify({ note: oversized }), headers: {} });
    assert.equal(r.status, 413);
    assert.equal(r.json.code, 'payload-too-large');
    assert.equal(srv.ledger.events.length, before, 'an oversized request must not create a ledger event');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('POST /self-service/issue: an honest oversized Content-Length is rejected without the server reading the body at all', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port: srv.port,
          method: 'POST',
          path: '/self-service/issue',
          headers: { 'content-type': 'application/json', 'content-length': 10_000, connection: 'close' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        }
      );
      req.on('error', reject);
      // Deliberately never writes the declared 10,000 bytes -- if the server
      // were reading the body before checking Content-Length, this request
      // would hang waiting for bytes that never arrive.
      req.end();
    });
    assert.equal(r.status, 413);
    assert.equal(r.json.code, 'payload-too-large');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ================================================================ Phase 7: global quota === */

test('global issuance quota is separate from per-IP limiting and fails closed with Retry-After', async () => {
  const srv = await bootServer({
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_GLOBAL_QUOTA_MAX: '1',
    TII_SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS: '60000',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '100',
  });
  try {
    const before = srv.ledger.events.length;
    const a = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    const b = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(a.status, 201);
    assert.equal(b.status, 429);
    assert.ok(b.headers['retry-after']);
    assert.equal(srv.ledger.events.length, before + 1, 'the rejected request never appended to the ledger');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== Phase 8: storage quota === */

test('storage quota (event count ceiling) is checked before accepting issuance and fails closed', async () => {
  const srv = await bootServer({
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_MAX_EVENT_COUNT: '1',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '100',
  });
  try {
    const a = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    const before = srv.ledger.events.length;
    const b = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(a.status, 201);
    assert.equal(b.status, 503);
    assert.equal(srv.ledger.events.length, before, 'no partial append occurred once the storage quota was exceeded');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== Phase 9: server timeouts === */

test('conservative Node-native HTTP timeouts are configured on the server', async () => {
  const srv = await bootServer({});
  try {
    assert.equal(srv.server.headersTimeout, 10_000);
    assert.equal(srv.server.requestTimeout, 15_000);
    assert.equal(srv.server.keepAliveTimeout, 5_000);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ================================================ Phase 10: admin route exposure policy === */

test('public-self-service mode: GET /admin fails closed', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_ADMIN_TOKEN: 'sometoken' });
  try {
    const r = await request(srv.port, 'GET', '/admin');
    assert.equal(r.status, 404);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('public-self-service mode: POST /admin/issue fails closed even with a correct token', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_ADMIN_TOKEN: 'sometoken' });
  try {
    const r = await request(srv.port, 'POST', '/admin/issue', { headers: { 'x-tii-token': 'sometoken' }, body: {} });
    assert.equal(r.status, 404);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('ordinary (non-self-service) deployment mode: admin routes remain available, unaffected', async () => {
  const srv = await bootServer({ TII_ADMIN_TOKEN: 'sometoken' });
  try {
    const r = await request(srv.port, 'GET', '/admin');
    assert.equal(r.status, 200);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ======================================================== Phase 11: resolver provenance === */

test('resolution page shows registry provenance only when TII_REGISTRY_LABEL is configured', async () => {
  const withLabel = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true', TII_REGISTRY_LABEL: 'Example Public TEST Registry' });
  try {
    const issued = await request(withLabel.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(issued.status, 201);
    const page = await request(withLabel.port, 'GET', `/tii/${encodeURIComponent(issued.json.tii)}`);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('Example Public TEST Registry'));
    assert.ok(page.text.includes('/verify'));
  } finally {
    await withLabel.close();
    withLabel.restoreEnv();
  }

  const withoutLabel = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const issued = await request(withoutLabel.port, 'POST', '/self-service/issue', { body: {} });
    const page = await request(withoutLabel.port, 'GET', `/tii/${encodeURIComponent(issued.json.tii)}`);
    assert.ok(!page.text.includes('Example Public TEST Registry'));
  } finally {
    await withoutLabel.close();
    withoutLabel.restoreEnv();
  }
});

/* ===================================================================== Phase 12: healthz === */

test('GET /healthz is read-only and reports process/ledger/chain/deployment-mode status', async () => {
  const srv = await bootServer({});
  try {
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.process_alive, true);
    assert.equal(r.json.ledger_readable, true);
    assert.equal(r.json.chain_valid, true);
    assert.equal(r.json.deployment_mode, 'default');
    assert.equal(r.json.deployment_mode_configured_correctly, true);
    assert.equal(srv.ledger.events.length, before, 'healthz never mutates the ledger');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ====================================================================== Phase 13: verify === */

test('GET /verify (JSON) exposes registry test-status alongside chain integrity, without loading production material', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true', TII_REGISTRY_LABEL: 'Example Public TEST Registry' });
  try {
    const r = await request(srv.port, 'GET', '/verify', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'VALID');
    assert.equal(typeof r.json.event_count, 'number');
    assert.equal(typeof r.json.head_hash, 'string');
    assert.equal(r.json.registry_status.self_service_test_registry, true);
    assert.equal(r.json.registry_status.registry_label, 'Example Public TEST Registry');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================================ Phase 18: abuse/privacy === */

test('self-service issuance never stores the client IP anywhere in the ledger event', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true' });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'x-forwarded-for': '203.0.113.55' }, body: { note: 'hello' } });
    assert.equal(r.status, 201);
    const raw = JSON.stringify(r.json.event);
    assert.ok(!raw.includes('203.0.113.55'));
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('a rate-limited self-service request creates no ledger event', async () => {
  const srv = await bootServer({ TII_SELF_SERVICE_ENABLED: 'true', TII_SELF_SERVICE_RATE_LIMIT_MAX: '1', TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000' });
  try {
    await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(r.status, 429);
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ========================================================== Phase 19: security boundary === */

test('security boundary: public-self-service mode cannot reach any production mechanism', async () => {
  const kp = generateKeypair();
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_ADMIN_TOKEN: 'sometoken',
    TII_CHECKPOINT_PRIVATE_KEY: kp.privateKeyPem,
  });
  try {
    // production issuance module is not importable from this running process's
    // module graph via the self-service path -- confirmed structurally (see the
    // permanent regression test in test/production-gate.test.js §0) and here
    // behaviorally: issuance always reports identifier_status "test".
    const r = await request(srv.port, 'POST', '/self-service/issue', { body: {} });
    assert.equal(r.status, 201);
    assert.equal(r.json.identifier_status, 'test');

    // admin (the only other mutating surface) is unreachable in this mode,
    // even with a correct token.
    const admin = await request(srv.port, 'GET', '/admin');
    assert.equal(admin.status, 404);

    // no checkpoint is ever produced, despite a valid key being configured.
    const files = fs.readdirSync(process.env.TII_CHECKPOINT_DIR);
    assert.ok(!files.some((f) => f.startsWith('checkpoint-')));

    // /verify never reveals VERIFIED checkpoint status sourced from a
    // production key -- no checkpoint exists in this disposable directory at all.
    const verify = await request(srv.port, 'GET', '/checkpoint/verify');
    assert.equal(verify.json.status, 'MISSING');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('security boundary: src/server.js does not import the production-only issuance module', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'server.js'), 'utf8');
  assert.ok(!/require\(.*production-issuance/.test(src));
});

test('sanity: the real repository ledger and checkpoint directory are untouched by this entire test file', () => {
  assert.ok(fs.existsSync(REPO_DEFAULT_LEDGER_FILE));
  // Only asserts existence/reachability here; byte-for-byte production-state
  // comparison against the pre-suite baseline is performed independently as
  // part of the full verification pass (git diff / shasum / ledger.verify()
  // outside this file), which is the authoritative check for this invariant.
});
