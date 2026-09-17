'use strict';

/**
 * Full-path adversarial audit of TII issuance: generation -> collision
 * checking -> ledger persistence -> registry/catalog generation -> resolver
 * visibility -> failure recovery. See
 * spec/issuance-path-audit-2026-09-19.md for the full trace and the
 * classification of every failure mode found.
 *
 * Production issuance is NEVER enabled anywhere in this file — every test
 * either exercises the general (TEST) issuance path (src/ledger.js
 * issueTII(), always identifier_status "test") or a disposable ledger/
 * static-build directory unrelated to the committed repository state.
 * spec/production-launch-gate.md's own permanent regression test
 * (test/production-gate.test.js) already proves the real repo's gate stays
 * closed regardless of what this file does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { Ledger } = require('../src/ledger');
const exporters = require('../src/export');
const { tiiToFileSlug } = require('../src/id');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
const R = (id) => ({ id, kind: 'person' });

/* ============================================================ *
 * 1. TOKEN COLLISION at the ledger level (not just the generator)
 * ============================================================ */

test('COLLISION — ledger.issueTII() discards an authoritatively-collided candidate and retries, using the REAL unmodified newTII()/randomBody() retry loop (only the underlying CSPRNG byte source is faked, deterministically)', () => {
  const file = path.join(tmpDir('tii-collide-'), 'ledger.jsonl');
  const l = new Ledger(file).load();

  // ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' (id.js): index of 'a' is
  // 10, index of 'b' is 11 -- both well under the rejection-sampling
  // threshold (248), so every byte below is accepted on the first try.
  // src/id.js calls crypto.randomBytes(1) once per body character; it is a
  // property access (`const crypto = require('node:crypto')`), not
  // destructured, so patching the property here genuinely intercepts every
  // call id.js makes -- unlike ledger.js's `const { newTII } = require('./id')`,
  // which captures the function value at require-time and could not be
  // intercepted by patching src/id.js's exports instead.
  const crypto = require('node:crypto');
  const originalRandomBytes = crypto.randomBytes;
  // First 12 bytes -> "aaaaaaaaaaaa" (the pre-occupied candidate's body);
  // every byte after that -> "bbbbbbbbbbbb" (the fresh candidate).
  let byteIndex = 0;
  crypto.randomBytes = (n) => {
    if (n !== 1) return originalRandomBytes(n); // only id.js's 1-byte-at-a-time calls are faked
    const value = byteIndex < 12 ? 10 : 11;
    byteIndex++;
    return Buffer.from([value]);
  };

  try {
    const preOccupied = 'tii:' + 'a'.repeat(12);
    l.append({ tii: preOccupied, event_type: 'tii.issued', recorder: R('seed'), content: { identifier_status: 'test' } });

    const { tii } = l.issueTII({ recorder: R('t') });
    assert.equal(tii, 'tii:' + 'b'.repeat(12), 'the collided first draw was discarded and the retry (a genuinely fresh candidate) was issued');
    assert.equal(l.events.filter((e) => e.tii === preOccupied).length, 1, 'the pre-occupied identifier appears exactly once — the seed event, never duplicated by the collision');
    assert.equal(l.verify().ok, true);
  } finally {
    crypto.randomBytes = originalRandomBytes;
  }
});

/* ============================================================ *
 * 2. CONCURRENT ISSUANCE — real OS processes, general (test) path
 * ============================================================ */

function writeWorker(file, workerScript) {
  const workerFile = path.join(path.dirname(file), 'worker-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(workerFile, workerScript);
  return workerFile;
}

function runWorkers(workerFile, count) {
  return Promise.all(
    Array.from({ length: count }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerFile]);
      let out = '', err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('worker exited ' + code + ': ' + err))));
    }))
  );
}

test('CONCURRENCY — N processes each issuing a FRESH test TII (no idempotency key) concurrently: N distinct identifiers, zero corruption, zero collisions', async () => {
  const file = path.join(tmpDir('tii-concur-fresh-'), 'ledger.jsonl');
  new Ledger(file).load(); // create the file

  const workerFile = writeWorker(
    file,
    `
    const { Ledger } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'ledger'))});
    const l = new Ledger(${JSON.stringify(file)}).load();
    let tii = null;
    for (let attempt = 0; attempt < 30 && !tii; attempt++) {
      try {
        tii = l.issueTII({ recorder: { id: 'w' + process.pid, kind: 'mechanism' } }).tii;
      } catch (e) {
        if (e.code !== 'writer-locked') throw e; // legitimate contention under concurrency -- retry this worker's own single issuance
      }
    }
    process.stdout.write(tii || '');
    `
  );

  const N = 8;
  const results = await runWorkers(workerFile, N);
  const distinct = new Set(results);
  assert.equal(distinct.size, N, 'every concurrent fresh issuance must produce a distinct identifier');

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.event_type === 'tii.issued').length, N);
  assert.equal(final.verify().ok, true, 'ledger chain integrity holds after concurrent fresh issuance');
  fs.unlinkSync(workerFile);
});

test('CONCURRENCY — N processes issuing with the SAME idempotency key converge on exactly ONE canonical tii.issued event (general test path, not just gated production)', async () => {
  const file = path.join(tmpDir('tii-concur-idem-'), 'ledger.jsonl');
  new Ledger(file).load();

  const workerFile = writeWorker(
    file,
    `
    const { Ledger } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'ledger'))});
    const l = new Ledger(${JSON.stringify(file)}).load();
    let result = null, err = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        result = l.issueTII({ recorder: { id: 'idem-worker', kind: 'mechanism' }, idempotency_key: 'SHARED-KEY' });
        break;
      } catch (e) {
        if (e.code === 'writer-locked') continue;
        err = e.message;
        break;
      }
    }
    process.stdout.write(JSON.stringify({ tii: result ? result.tii : null, err }));
    `
  );

  const N = 8;
  const outputs = await runWorkers(workerFile, N);
  const results = outputs.map((o) => JSON.parse(o));
  const successes = results.filter((r) => r.tii);
  assert.ok(successes.length >= 1);
  const distinctTiis = new Set(successes.map((r) => r.tii));
  assert.equal(distinctTiis.size, 1, 'every worker sharing the idempotency key must agree on the SAME resulting identifier');

  const final = new Ledger(file).load();
  assert.equal(final.events.filter((e) => e.event_type === 'tii.issued').length, 1, 'exactly one canonical issuance event, regardless of how many concurrent callers shared the key');
  assert.equal(final.verify().ok, true);
  fs.unlinkSync(workerFile);
});

/* ============================================================ *
 * 3. NON-IDEMPOTENT OPERATIONS — identified and demonstrated, not silently assumed
 * ============================================================ */

test('NON-IDEMPOTENT BY DESIGN (documented limitation, unchanged) — issueTII() called twice with NO idempotency key double-issues; this is the caller\'s responsibility, not a ledger defect', () => {
  const file = path.join(tmpDir('tii-nonidempotent-'), 'ledger.jsonl');
  const l = new Ledger(file).load();
  const a = l.issueTII({ recorder: R('t') });
  const b = l.issueTII({ recorder: R('t') }); // simulates a naive retried request with no dedup key
  assert.notEqual(a.tii, b.tii, 'without an idempotency_key, TWO issuances happen -- this is expected, not a bug: callers that need retry-safety must supply a key (spec/crash-recovery.md, spec/production-launch-gate.md G6)');
  assert.equal(l.events.filter((e) => e.event_type === 'tii.issued').length, 2);
});

/* ============================================================ *
 * 4. REBUILD ATOMICITY — registry/catalog generation, resolver visibility
 * ============================================================ */

function seededLedgerFile(n = 3) {
  const file = path.join(tmpDir('tii-rebuild-'), 'ledger.jsonl');
  const l = new Ledger(file).load();
  for (let i = 0; i < n; i++) l.issueTII({ recorder: R('seed') });
  return { file, ledger: l };
}

test('REBUILD ATOMICITY — a build interrupted partway through never touches a pre-existing outDir (deterministic forced-failure simulation, same technique as the existing crash-recovery suite)', () => {
  const { ledger } = seededLedgerFile(5);
  const outDir = path.join(tmpDir('tii-rebuild-out-'), 'site');

  // First, a real successful build, so outDir exists with known-good content.
  exporters.buildStaticSite(ledger, outDir);
  const before = fs.readdirSync(outDir).sort();
  const beforeCatalog = fs.readFileSync(path.join(outDir, 'catalog.json'), 'utf8');

  // Now force a failure partway through a SECOND build (simulating a crash
  // mid-rebuild) by making fs.writeFileSync throw after a handful of calls --
  // deterministic, not timing-dependent.
  const originalWrite = fs.writeFileSync;
  let calls = 0;
  fs.writeFileSync = function (...args) {
    calls++;
    if (calls > 4) throw new Error('SIMULATED CRASH mid-rebuild');
    return originalWrite.apply(fs, args);
  };
  try {
    assert.throws(() => exporters.buildStaticSite(ledger, outDir), /SIMULATED CRASH/);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  // outDir must be EXACTLY as it was before the failed attempt -- not
  // partially overwritten, not deleted, not merged with half-written files.
  const after = fs.readdirSync(outDir).sort();
  const afterCatalog = fs.readFileSync(path.join(outDir, 'catalog.json'), 'utf8');
  assert.deepEqual(after, before, 'outDir file listing must be byte-for-byte unchanged after an interrupted rebuild');
  assert.equal(afterCatalog, beforeCatalog, 'catalog.json must be unchanged -- never a partial/mid-write version');

  // No leftover ".building-*" directory should be sitting where a resolver
  // might accidentally serve it from (it should be a sibling of outDir, not
  // inside it, and this build's cleanup on catch removes it).
  const parent = path.dirname(outDir);
  const leftovers = fs.readdirSync(parent).filter((f) => f.startsWith(path.basename(outDir) + '.building-'));
  assert.equal(leftovers.length, 0, 'a thrown-error failure must clean up its own temp build directory');
});

test('REBUILD ATOMICITY — a build interrupted by a hard failure DURING the final swap leaves the OLD build recoverable, not deleted', () => {
  const { ledger } = seededLedgerFile(3);
  const outDir = path.join(tmpDir('tii-rebuild-swap-'), 'site');
  exporters.buildStaticSite(ledger, outDir);
  const beforeCatalog = fs.readFileSync(path.join(outDir, 'catalog.json'), 'utf8');

  // Force the SECOND of the two swap renames to fail -- simulating a crash
  // exactly between "old build moved aside" and "new build moved into
  // place". This is the one narrow window documented in
  // src/export.js buildStaticSite()'s own doc comment as not fully
  // eliminable without changing directory topology (e.g. a symlink swap).
  const originalRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = function (...args) {
    renameCalls++;
    if (renameCalls === 2) throw new Error('SIMULATED CRASH during atomic swap');
    return originalRename.apply(fs, args);
  };
  let threw = false;
  try {
    exporters.buildStaticSite(ledger, outDir);
  } catch (e) {
    threw = /SIMULATED CRASH/.test(e.message);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.ok(threw, 'the simulated failure must propagate, not be swallowed');

  // The OLD build's content must still exist SOMEWHERE on disk (moved aside,
  // not deleted) -- this is the documented, accepted trade-off: outDir
  // itself may be transiently absent, but no build is ever silently lost.
  const parent = path.dirname(outDir);
  const staleDirs = fs.readdirSync(parent).filter((f) => f.startsWith(path.basename(outDir) + '.stale-'));
  assert.equal(staleDirs.length, 1, 'the pre-swap build must be recoverable from a .stale-* sibling directory, not lost');
  const recovered = fs.readFileSync(path.join(parent, staleDirs[0], 'catalog.json'), 'utf8');
  assert.equal(recovered, beforeCatalog, 'the recoverable old build must be byte-identical to what was live before the interrupted swap');

  // A subsequent, uninterrupted rebuild must succeed and restore a fully
  // consistent site, regardless of the transient absence above.
  exporters.buildStaticSite(ledger, outDir);
  assert.ok(fs.existsSync(path.join(outDir, 'catalog.json')), 'recovery: a clean rebuild after the interrupted swap must succeed');
});

test('REBUILD ATOMICITY — the FIRST-EVER build (outDir does not exist yet) is a single atomic rename with zero inconsistent-state window', () => {
  const { ledger } = seededLedgerFile(2);
  const parent = tmpDir('tii-rebuild-first-');
  const outDir = path.join(parent, 'site'); // deliberately never created before this call
  assert.equal(fs.existsSync(outDir), false);
  exporters.buildStaticSite(ledger, outDir);
  assert.ok(fs.existsSync(path.join(outDir, 'catalog.json')));
  // no leftover temp/stale directories after a clean run
  const leftovers = fs.readdirSync(parent).filter((f) => f !== 'site');
  assert.equal(leftovers.length, 0, 'a successful build leaves no temp or stale directories behind');
});

/* ============================================================ *
 * 5. REGISTRY <-> RESOLVER VISIBILITY CONSISTENCY
 * ============================================================ */

test('CONSISTENCY — after a clean rebuild, catalog.json\'s identifier list exactly matches the set of per-identifier files on disk (no orphans, no missing entries)', () => {
  const { ledger } = seededLedgerFile(6);
  const outDir = path.join(tmpDir('tii-consistency-'), 'site');
  exporters.buildStaticSite(ledger, outDir);

  const catalog = JSON.parse(fs.readFileSync(path.join(outDir, 'catalog.json'), 'utf8'));
  const catalogSlugs = new Set(catalog.identifiers.map((i) => i.slug));

  const filesOnDisk = fs
    .readdirSync(path.join(outDir, 'tii'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const diskSlugs = new Set(filesOnDisk);

  assert.deepEqual([...catalogSlugs].sort(), [...diskSlugs].sort(), 'the registry (catalog.json) and the resolver (per-identifier files) must always agree on exactly which identifiers exist');
  assert.equal(catalog.identifiers.length, ledger.listTIIs().length, 'the registry must list every issued identifier, no more, no fewer');

  for (const tii of ledger.listTIIs()) {
    const slug = tiiToFileSlug(tii);
    assert.ok(diskSlugs.has(slug), `resolver must have a page for ${tii}`);
    assert.ok(catalogSlugs.has(slug), `registry must list ${tii}`);
  }
});
