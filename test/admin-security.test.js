'use strict';

/**
 * §12-§16 of production-hardening Phase 1 (P0-B) — admin must fail closed.
 * spec/production-hardening-phase1.md §P0-B.
 *
 * Spins up the real src/server.js HTTP server (module cache cleared between
 * scenarios so each picks up fresh env vars) on an ephemeral port and issues
 * real HTTP requests — this exercises the actual authorization logic, not a
 * re-implementation of it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { Ledger } = require('../src/ledger');

function tmpLedgerFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-admin-'));
  return path.join(dir, 'ledger.jsonl');
}

/** Boot a fresh instance of src/server.js with the given env, on an ephemeral port. */
async function bootServer(env) {
  const prevEnv = { ...process.env };
  Object.assign(process.env, { TII_LEDGER: tmpLedgerFile(), TII_ADMIN_TOKEN: '', TII_ADMIN_HASH_DIR: '', TII_CHECKPOINT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tii-ckpt-')) }, env);
  delete require.cache[require.resolve('../src/server')];
  const mod = require('../src/server');
  await new Promise((resolve) => mod.server.listen(0, resolve));
  const port = mod.server.address().port;
  return {
    ...mod,
    port,
    close: () => new Promise((resolve) => mod.server.close(resolve)),
    restoreEnv: () => Object.assign(process.env, prevEnv),
  };
}

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
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

/* ------------------------------------------------------------------- A/F --- */

test('A/F — NO ADMIN TOKEN CONFIGURED: admin is disabled, not open', async () => {
  const srv = await bootServer({ TII_ADMIN_TOKEN: '' });
  try {
    const page = await request(srv.port, 'GET', '/admin');
    assert.equal(page.status, 200);
    assert.match(page.text, /Admin is disabled/);
    assert.ok(!/Issue TII<\/h2>/.test(page.text), 'no issuance form when disabled');
    assert.ok(!/Append event/.test(page.text), 'no append-event form when disabled');
    assert.ok(!/Quick fill/.test(page.text), 'no quick-fill catalogue when disabled');

    const issue = await request(srv.port, 'POST', '/api/tii', { body: { recorder: 'x' } });
    assert.equal(issue.status, 401);
    assert.deepEqual(JSON.parse(issue.text).admin_availability, 'DISABLED');

    const formIssue = await request(srv.port, 'POST', '/admin/issue', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: undefined });
    assert.equal(formIssue.status, 401);
    assert.match(formIssue.text, /disabled/i);

    const status = JSON.parse((await request(srv.port, 'GET', '/status')).text);
    assert.equal(status.admin_availability, 'DISABLED');
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* --------------------------------------------------------------------- G --- */

test('G — WRONG TOKEN is rejected even when a token IS configured', async () => {
  const srv = await bootServer({ TII_ADMIN_TOKEN: 'correct-horse-battery-staple' });
  try {
    const wrong = await request(srv.port, 'POST', '/api/tii', { headers: { 'x-tii-token': 'guess' }, body: { recorder: 'x' } });
    assert.equal(wrong.status, 401);
    const empty = await request(srv.port, 'POST', '/api/tii', { body: { recorder: 'x' } });
    assert.equal(empty.status, 401);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* --------------------------------------------------------------------- H --- */

test('H — CORRECT TOKEN is accepted', async () => {
  const srv = await bootServer({ TII_ADMIN_TOKEN: 'correct-horse-battery-staple' });
  try {
    const ok = await request(srv.port, 'POST', '/api/tii', { headers: { 'x-tii-token': 'correct-horse-battery-staple' }, body: { recorder: 'x' } });
    assert.equal(ok.status, 201);
    assert.ok(JSON.parse(ok.text).tii.startsWith('tii:'));
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* --------------------------------------------------------------------- I --- */

test('I — the token never appears in any response, and never enters the ledger', async () => {
  const srv = await bootServer({ TII_ADMIN_TOKEN: 'super-secret-token-value-xyz' });
  try {
    const page = await request(srv.port, 'GET', '/admin');
    assert.ok(!page.text.includes('super-secret-token-value-xyz'), 'admin page does not echo the token');

    const issued = await request(srv.port, 'POST', '/api/tii', { headers: { 'x-tii-token': 'super-secret-token-value-xyz' }, body: { recorder: 'x' } });
    assert.equal(issued.status, 201);
    const tii = JSON.parse(issued.text).tii;

    const jsonl = await request(srv.port, 'GET', '/export/ledger.jsonl');
    assert.ok(!jsonl.text.includes('super-secret-token-value-xyz'), 'token never enters the ledger / exports');

    const resolution = await request(srv.port, 'GET', '/tii/' + tii.replace(/[^a-z0-9]+/gi, '_'));
    assert.ok(!resolution.text.includes('super-secret-token-value-xyz'));
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

/* --------------------------------------------------------------- J/K/hash --- */

test('J/K — hash-file: disabled with no safe directory configured; path traversal and absolute paths rejected when configured; arbitrary server files unreadable', async () => {
  // disabled entirely — the admin page says so, and the endpoint itself refuses to hash anything
  {
    const srv = await bootServer({ TII_ADMIN_TOKEN: 't', TII_ADMIN_HASH_DIR: '' });
    try {
      const page = await request(srv.port, 'GET', '/admin');
      assert.match(page.text, /Disabled — <code>TII_ADMIN_HASH_DIR<\/code>/);

      const attempt = await requestForm(srv.port, '/admin/hash-file', { path: 'anything.txt', token: 't' });
      assert.equal(attempt.status, 400);
      assert.match(attempt.text, /TII_ADMIN_HASH_DIR is not configured/);
    } finally {
      await srv.close();
      srv.restoreEnv();
    }
  }

  // enabled with a safe dir: traversal + absolute + arbitrary system file all rejected
  {
    const safeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-safe-'));
    fs.writeFileSync(path.join(safeDir, 'allowed.txt'), 'hello world');
    const srv = await bootServer({ TII_ADMIN_TOKEN: 'tok', TII_ADMIN_HASH_DIR: safeDir });
    try {
      const good = await requestForm(srv.port, '/admin/hash-file', { path: 'allowed.txt', token: 'tok' });
      assert.equal(good.status, 200);
      assert.match(good.text, /SHA-256/);

      const traversal = await requestForm(srv.port, '/admin/hash-file', { path: '../../../../../../etc/passwd', token: 'tok' });
      assert.equal(traversal.status, 400);
      assert.match(traversal.text, /escapes the configured safe directory/);

      const absolute = await requestForm(srv.port, '/admin/hash-file', { path: '/etc/passwd', token: 'tok' });
      assert.equal(absolute.status, 400);
      assert.match(absolute.text, /must be relative/);

      const encodedTraversal = await requestForm(srv.port, '/admin/hash-file', { path: 'sub/../../outside.txt', token: 'tok' });
      assert.equal(encodedTraversal.status, 400);
    } finally {
      await srv.close();
      srv.restoreEnv();
    }
  }
});

/**
 * PERMANENT REGRESSION (found by adversarial verification, spec/phase1-adversarial-verification.md
 * §13, severity HIGH): the original resolveSafeHashPath() used only a lexical
 * path.resolve() + string-prefix check. A symlink planted INSIDE the safe
 * directory pointing OUTSIDE it was never followed by that check, so hashing
 * a path like "escape-link.txt" (a symlink to /etc/passwd or any other file)
 * silently read straight through the "safe directory" confinement — a direct
 * symlink, a nested symlink chain, and a symlinked directory all escaped.
 * Fixed by resolving both the safe directory and the requested path through
 * fs.realpathSync() before the confinement check (src/server.js
 * resolveSafeHashPath). This test must remain in the suite permanently.
 */
test('M — PERMANENT REGRESSION: a symlink inside the safe directory cannot be used to hash a file outside it', async () => {
  const safeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-safe-symlink-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-outside-symlink-'));
  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'outside content that must never be reachable through the safe directory\n');

  fs.symlinkSync(secretFile, path.join(safeDir, 'direct-link.txt'));
  fs.symlinkSync(path.join(safeDir, 'direct-link.txt'), path.join(safeDir, 'nested-link.txt'));
  fs.symlinkSync(outsideDir, path.join(safeDir, 'escape-dir'));

  const srv = await bootServer({ TII_ADMIN_TOKEN: 'tok', TII_ADMIN_HASH_DIR: safeDir });
  try {
    for (const p of ['direct-link.txt', 'nested-link.txt', 'escape-dir/secret.txt']) {
      const r = await requestForm(srv.port, '/admin/hash-file', { path: p, token: 'tok' });
      assert.equal(r.status, 400, `symlink escape via "${p}" must be rejected, got ${r.status}`);
      assert.match(r.text, /escapes the configured safe directory/);
    }
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

function requestForm(port, urlPath, fields) {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, method: 'POST', path: urlPath, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* --------------------------------------------------------------------- L --- */

/**
 * PERMANENT REGRESSION (found by adversarial verification, spec/phase1-adversarial-verification.md
 * §16, severity MEDIUM-HIGH): GET /checkpoint/verify is deliberately UNAUTHENTICATED
 * (checkpoint verification is meant to be publicly checkable), but its `file`
 * query parameter was forwarded uninspected into checkpointStore.verifyCheckpoint(),
 * which accepts an absolute path as a TRUSTED parameter (the CLI legitimately
 * verifies externally-retrieved checkpoint files this way). That made the public
 * HTTP route an unauthenticated file-existence oracle over the entire server
 * filesystem (ENOENT vs. parse-error messages distinguish existing from
 * non-existing paths) and would read+attempt to verify ANY JSON file an attacker
 * could name. Fixed by restricting the route's `file` param to a bare filename
 * (src/server.js) before it ever reaches verifyCheckpoint() — the CLI's own
 * arbitrary-path capability is untouched. This test must remain in the suite
 * permanently.
 */
test('N — PERMANENT REGRESSION: GET /checkpoint/verify?file= cannot be used to probe or read arbitrary server paths', async () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-outside-ckpt-'));
  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'must never be reachable through the public checkpoint/verify route\n');

  const srv = await bootServer({});
  try {
    for (const badFile of [secretFile, '../../../../etc/passwd', 'sub/../../escape.json']) {
      const r = await request(srv.port, 'GET', '/checkpoint/verify?file=' + encodeURIComponent(badFile));
      assert.equal(r.status, 400, `"${badFile}" must be rejected before any filesystem access, got ${r.status}`);
      const body = JSON.parse(r.text);
      assert.equal(body.status, 'INVALID');
      assert.ok(!body.reason.includes(secretFile), 'no absolute path is echoed back for a rejected value');
    }
    // a bare filename is still accepted (just reports MISSING/INVALID for a nonexistent checkpoint, not a 400)
    const ok = await request(srv.port, 'GET', '/checkpoint/verify?file=' + encodeURIComponent('some-checkpoint.json'));
    assert.equal(ok.status, 200);
  } finally {
    await srv.close();
    srv.restoreEnv();
  }
});

test('L — static deployment exposes no admin mutation capability', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-static-admin-'));
  const l = new Ledger(path.join(dir, 'ledger.jsonl')).load();
  l.issueTII({ recorder: { id: 't', kind: 'person' } });
  const exporters = require('../src/export');
  const out = path.join(dir, 'public');
  exporters.buildStaticSite(l, out);

  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(out);
  assert.ok(!files.some((f) => /admin/i.test(path.basename(f))), 'no admin-named file in the static output');
  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(!/action="\/admin/.test(html), `${f} must not contain an admin form action`);
    assert.ok(!/method="POST"/i.test(html), `${f} is static HTML and must contain no POST form at all`);
  }
});
