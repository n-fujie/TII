'use strict';

/**
 * Trusted-proxy-origin validation for the Cloudflare-in-front-of-Fly
 * self-service deployment topology.
 *
 * The defect this closes: TII_TRUSTED_PROXY_HEADER=cf-connecting-ip alone
 * only checks that a CF-Connecting-IP header is *present* and
 * *well-formed* — it says nothing about whether Cloudflare actually
 * handled the request. A client that reaches the Fly origin directly can
 * set that header to anything it likes and walk straight past the per-IP
 * limiter's bucketing. The fix (src/server.js, TII_TRUSTED_PROXY_CIDRS /
 * isTrustedProxyPeer() / selfServiceClientIp()'s cf-connecting-ip branch)
 * requires, in public-self-service deployment mode specifically, that the
 * immediate peer Fly itself saw (Fly-Client-IP) belongs to an explicitly
 * configured allowlist of trusted proxy networks before CF-Connecting-IP is
 * trusted at all — otherwise the self-service write is rejected outright
 * (403), never silently downgraded to trusting the socket address (which,
 * behind Fly, is Fly's own internal forwarding address, not a meaningful
 * client identity).
 *
 * RFC 5737 documentation ranges stand in for "Cloudflare's network"
 * (203.0.113.0/24, TEST-NET-3) and "an outside attacker's network"
 * (198.51.100.0/24, TEST-NET-2) throughout; RFC 3849's 2001:db8::/32
 * stands in for an IPv6 trusted range.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-proxytrust-'));
  return path.join(dir, 'ledger.jsonl');
}

function tmpCheckpointDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tii-proxytrust-ckpt-'));
}

const MANAGED_ENV_KEYS = [
  'TII_SELF_SERVICE_ENABLED',
  'TII_SELF_SERVICE_RATE_LIMIT_MAX',
  'TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS',
  'TII_SELF_SERVICE_GLOBAL_QUOTA_MAX',
  'TII_SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS',
  'TII_DEPLOYMENT_MODE',
  'TII_TRUSTED_PROXY_HEADER',
  'TII_TRUSTED_PROXY_CIDRS',
  'TII_ADMIN_TOKEN',
];

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

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: 'localhost',
        port,
        method,
        path: urlPath,
        headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json });
        });
      }
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const CF_TRUSTED = { TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip', TII_TRUSTED_PROXY_CIDRS: '203.0.113.0/24' };

/* =============================================================== test 1 === */

test('Cloudflare-trusted mode: Fly peer inside trusted CIDR + valid CF-Connecting-IP -> accepted', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '203.0.113.5', 'cf-connecting-ip': '198.51.100.42' },
      body: {},
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.identifier_status, 'test');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 2 === */

test('Cloudflare-trusted mode: Fly peer OUTSIDE trusted CIDR -> CF-Connecting-IP not trusted, write rejected', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '198.51.100.7', 'cf-connecting-ip': '203.0.113.99' },
      body: {},
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'proxy-origin-untrusted');
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 3 === */

test('direct attacker with no Fly-Client-IP at all cannot choose an apparent client IP via a forged CF-Connecting-IP', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'cf-connecting-ip': '1.2.3.4' }, // no fly-client-ip header -- a request that never passed through Fly's own edge reporting
      body: {},
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'proxy-origin-untrusted');
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 4 === */

test('direct attacker supplying a forged X-Forwarded-For gets no benefit -- still rejected in cf-connecting-ip mode', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '1.2.3.4' }, // still no valid fly-client-ip
      body: {},
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'proxy-origin-untrusted');
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 5 === */

test('multiple/malformed CF-Connecting-IP values, even from a trusted Fly peer, are rejected rather than trusted', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const before = srv.ledger.events.length;
    const r = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '203.0.113.5', 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' },
      body: {},
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'proxy-origin-untrusted');
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 6 === */

test('malformed TII_TRUSTED_PROXY_CIDRS entries fail startup', () => {
  for (const bad of ['not-a-cidr', '203.0.113.0/33', '2001:db8::/129', '999.0.0.1/24', '203.0.113.0', ',']) {
    const handle = freshEnv({
      TII_DEPLOYMENT_MODE: 'public-self-service',
      TII_SELF_SERVICE_ENABLED: 'true',
      TII_LEDGER: tmpLedgerFile(),
      TII_CHECKPOINT_DIR: tmpCheckpointDir(),
      TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip',
      TII_TRUSTED_PROXY_CIDRS: bad,
    });
    try {
      assert.throws(() => require('../src/server'), undefined, `expected startup to fail for TII_TRUSTED_PROXY_CIDRS=${JSON.stringify(bad)}`);
    } finally {
      handle.restoreEnv();
    }
  }
});

/* =============================================================== test 7 === */

test('empty TII_TRUSTED_PROXY_CIDRS with cf-connecting-ip selected fails public-self-service startup', () => {
  const handle = freshEnv({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_LEDGER: tmpLedgerFile(),
    TII_CHECKPOINT_DIR: tmpCheckpointDir(),
    TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip',
    // TII_TRUSTED_PROXY_CIDRS deliberately unset
  });
  try {
    assert.throws(() => require('../src/server'), /TII_TRUSTED_PROXY_CIDRS/);
  } finally {
    handle.restoreEnv();
  }
});

/* =============================================================== test 8 === */

test('Fly-direct mode (TII_TRUSTED_PROXY_HEADER=fly-client-ip) works without Cloudflare or any CIDR configuration', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_TRUSTED_PROXY_HEADER: 'fly-client-ip',
    // no TII_TRUSTED_PROXY_CIDRS -- must not be required in this mode
  });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'fly-client-ip': '203.0.113.5' }, body: {} });
    assert.equal(r.status, 201);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* =============================================================== test 9 === */

test('Fly-direct mode: a Cloudflare header has zero effect on resolved identity', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_TRUSTED_PROXY_HEADER: 'fly-client-ip',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '1',
    TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000',
  });
  try {
    // Same fly-client-ip, wildly different (and irrelevant) cf-connecting-ip
    // values on each call -- if CF-Connecting-IP had any influence here, the
    // second call would be bucketed separately and succeed; it must not.
    const a = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '203.0.113.5', 'cf-connecting-ip': '1.1.1.1' },
      body: {},
    });
    const b = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '203.0.113.5', 'cf-connecting-ip': '2.2.2.2' },
      body: {},
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 429, 'both requests share the same fly-client-ip identity regardless of the differing cf-connecting-ip values');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================================== test 10 === */

test('rate limiting cannot be bypassed by varying a forged CF-Connecting-IP on direct-origin requests', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '1',
    TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000',
    ...CF_TRUSTED,
  });
  try {
    const before = srv.ledger.events.length;
    const attempts = await Promise.all(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((fakeIp) =>
        request(srv.port, 'POST', '/self-service/issue', { headers: { 'cf-connecting-ip': fakeIp }, body: {} })
      )
    );
    // None of these arrived through the trusted Fly peer -- every single one
    // must be uniformly rejected, never split into distinct per-IP buckets
    // that would each get their own quota.
    for (const r of attempts) {
      assert.equal(r.status, 403);
      assert.equal(r.json.code, 'proxy-origin-untrusted');
    }
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================================== test 11 === */

test('global quota remains an independent backstop even for legitimately Cloudflare-routed traffic', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_SELF_SERVICE_GLOBAL_QUOTA_MAX: '1',
    TII_SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS: '60000',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '100',
    ...CF_TRUSTED,
  });
  try {
    const trusted = { 'fly-client-ip': '203.0.113.5', 'cf-connecting-ip': '9.9.9.9' };
    const a = await request(srv.port, 'POST', '/self-service/issue', { headers: trusted, body: {} });
    const b = await request(srv.port, 'POST', '/self-service/issue', { headers: { ...trusted, 'cf-connecting-ip': '9.9.9.10' }, body: {} });
    assert.equal(a.status, 201);
    assert.equal(b.status, 429, 'a second, distinct, legitimately-trusted visitor is still blocked once the global quota is exhausted');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ============================================================== test 12 === */

test('no rejected proxy-trust request creates a ledger event, across repeated attempts', async () => {
  const srv = await bootServer({ TII_DEPLOYMENT_MODE: 'public-self-service', TII_SELF_SERVICE_ENABLED: 'true', ...CF_TRUSTED });
  try {
    const before = srv.ledger.events.length;
    for (let i = 0; i < 5; i++) {
      await request(srv.port, 'POST', '/self-service/issue', { headers: { 'cf-connecting-ip': `10.0.0.${i}` }, body: {} });
    }
    assert.equal(srv.ledger.events.length, before);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* ======================================================== supporting coverage === */

test('CIDR matching supports IPv6 ranges', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip',
    TII_TRUSTED_PROXY_CIDRS: '2001:db8::/32',
  });
  try {
    const inside = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '2001:db8::1', 'cf-connecting-ip': '203.0.113.5' },
      body: {},
    });
    const outside = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '2001:db9::1', 'cf-connecting-ip': '203.0.113.5' },
      body: {},
    });
    assert.equal(inside.status, 201);
    assert.equal(outside.status, 403);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('ordinary (non-public-self-service) deployment with cf-connecting-ip keeps the old soft-fallback behavior (backward compatible)', async () => {
  const srv = await bootServer({
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip',
    TII_SELF_SERVICE_RATE_LIMIT_MAX: '1',
    TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS: '60000',
    // no TII_DEPLOYMENT_MODE, no TII_TRUSTED_PROXY_CIDRS -- must not be required outside public-self-service mode
  });
  try {
    const r = await request(srv.port, 'POST', '/self-service/issue', { headers: { 'cf-connecting-ip': '198.51.100.1' }, body: {} });
    assert.equal(r.status, 201, 'presence of a well-formed header is still sufficient outside public-self-service mode');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('multiple trusted CIDR entries (comma-separated) are all honored', async () => {
  const srv = await bootServer({
    TII_DEPLOYMENT_MODE: 'public-self-service',
    TII_SELF_SERVICE_ENABLED: 'true',
    TII_TRUSTED_PROXY_HEADER: 'cf-connecting-ip',
    TII_TRUSTED_PROXY_CIDRS: '203.0.113.0/24, 198.51.100.128/25',
  });
  try {
    const a = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '203.0.113.1', 'cf-connecting-ip': '1.2.3.4' },
      body: {},
    });
    const b = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '198.51.100.200', 'cf-connecting-ip': '1.2.3.5' },
      body: {},
    });
    const c = await request(srv.port, 'POST', '/self-service/issue', {
      headers: { 'fly-client-ip': '198.51.100.1', 'cf-connecting-ip': '1.2.3.6' }, // outside the /25 half of that block
      body: {},
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(c.status, 403);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});
