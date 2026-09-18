'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { Ledger } = require('./ledger');
const { project } = require('./projection');
const { sha256File } = require('./hash');
const { tiiToFileSlug } = require('./id');
const { splitFragment } = require('./tii-lookup');
const { normalizeLang } = require('./i18n');
const views = require('./views');
const exporters = require('./export');
const checkpointStore = require('./checkpoint-store');
const statusModule = require('./status');

const DATA_FILE = process.env.TII_LEDGER || path.join(__dirname, '..', 'data', 'ledger.jsonl');
const PORT = Number(process.env.PORT || process.env.TII_PORT || 3009);
const ADMIN_TOKEN = process.env.TII_ADMIN_TOKEN || '';
const RESOLVER_BASE = process.env.TII_RESOLVER_BASE_URL || '';
const CHECKPOINT_DIR = process.env.TII_CHECKPOINT_DIR || path.join(__dirname, '..', 'checkpoints');
// P0-B: file hashing is restricted to a configured safe directory, or disabled
// entirely — never an arbitrary server path. See spec/production-hardening-phase1.md §P0-B.
//
// ADVERSARIAL VERIFICATION FINDING (spec/phase1-adversarial-verification.md §13,
// HIGH): the original lexical path.resolve()-only confinement was defeated by a
// symlink planted INSIDE the safe directory pointing outside it — a purely
// string-based prefix check never notices that the resolved path, once symlinks
// are followed, lands somewhere else entirely. Fixed by resolving both the safe
// directory and every requested path through fs.realpathSync() before the prefix
// check, so the check runs against where the path actually points on disk, not
// its literal spelling. realpath is resolved once for ADMIN_HASH_DIR at startup;
// if the configured directory does not exist yet, hashing is disabled rather than
// throwing at startup (an operator may configure the directory before it exists).
const ADMIN_HASH_DIR_REAL = (() => {
  if (!process.env.TII_ADMIN_HASH_DIR) return '';
  try {
    return fs.realpathSync(path.resolve(process.env.TII_ADMIN_HASH_DIR));
  } catch {
    return ''; // configured directory does not exist (yet) — hashing stays disabled, never falls open
  }
})();
const ADMIN_HASH_DIR = ADMIN_HASH_DIR_REAL;

const ledger = new Ledger(DATA_FILE).load();

/* --------------------------------------------------------------- helpers --- */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-TII-Status': 'experimental', ...headers });
  res.end(body);
}
const sendJSON = (res, s, o) =>
  send(res, s, JSON.stringify(o, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
const sendHTML = (res, s, h) => send(res, s, h, { 'Content-Type': 'text/html; charset=utf-8' });
const redirect = (res, loc) => {
  res.writeHead(302, { Location: loc });
  res.end();
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) reject(new Error('body too large'));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType = '') {
  if (!raw) return {};
  if (contentType.includes('application/json')) return JSON.parse(raw);
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/** Constant-time string compare (equal length required; timing-safe otherwise). */
function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // keep timing roughly comparable; length itself is not secret
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * P0-B — NO ADMIN TOKEN = ADMIN DISABLED. If TII_ADMIN_TOKEN is not
 * configured, this ALWAYS returns false: there is no anonymous/open fallback.
 * The token itself is never echoed anywhere in a response.
 */
function authorized(req, bodyToken) {
  if (!ADMIN_TOKEN) return false;
  const header =
    req.headers['x-tii-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return constantTimeEqual(header, ADMIN_TOKEN) || constantTimeEqual(bodyToken, ADMIN_TOKEN);
}

function jsonMaybe(str, fallback) {
  if (str === undefined || str === null || str === '') return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Resolve a path the admin may hash: must stay within ADMIN_HASH_DIR.
 *
 * Confinement is realpath-based, not merely lexical: a symlink INSIDE the safe
 * directory that points outside it is rejected, because the check runs against
 * where the path actually resolves on disk (fs.realpathSync, which follows every
 * symlink in the chain) rather than its literal spelling. A lexical
 * path.resolve()-only check is not sufficient — see
 * spec/phase1-adversarial-verification.md §13 for the failing case this closes
 * (direct symlink, nested symlink, and symlinked-directory escape all verified
 * fixed by this function). The realpath'd result is what gets hashed, not a
 * path re-derived from the caller's original string, which keeps the gap
 * between validation and read as small as the syscalls themselves — this does
 * not eliminate every theoretical TOCTOU window (a symlink swapped in the
 * instant between realpathSync and the read could still redirect a read; Node's
 * fs API has no portable O_NOFOLLOW-and-fstat-confine primitive), which is
 * documented as a residual, narrow limitation rather than silently claimed
 * fixed.
 */
function resolveSafeHashPath(relPath) {
  if (!ADMIN_HASH_DIR) throw new Error('file hashing is disabled (TII_ADMIN_HASH_DIR is not configured)');
  if (!relPath) throw new Error('path is required');
  if (path.isAbsolute(relPath)) throw new Error('path must be relative to the configured safe directory');
  const lexical = path.resolve(ADMIN_HASH_DIR, relPath);
  if (lexical !== ADMIN_HASH_DIR && !lexical.startsWith(ADMIN_HASH_DIR + path.sep)) {
    throw new Error('path escapes the configured safe directory');
  }
  let real;
  try {
    real = fs.realpathSync(lexical);
  } catch (e) {
    throw new Error('path does not exist or cannot be resolved: ' + e.message);
  }
  if (real !== ADMIN_HASH_DIR && !real.startsWith(ADMIN_HASH_DIR + path.sep)) {
    throw new Error('path escapes the configured safe directory (resolves outside it through a symlink)');
  }
  return real;
}

function idempotencyKeyFrom(req, body) {
  return req.headers['idempotency-key'] || body.idempotency_key || undefined;
}

/**
 * Best-effort checkpoint after a successful authoritative write (P0-A chosen
 * policy — see spec/checkpoint-operation.md §Policy). Never blocks or fails
 * the mutation: if no signing key is configured this is a silent no-op for
 * the RESPONSE (the absence is still visible and honest via /status and the
 * Audit page — "no key configured" is reported there, not hidden). Any
 * unexpected error is logged, never surfaced to the caller as a write failure.
 */
function maybeAutoCheckpoint() {
  try {
    if (!checkpointStore.resolveSigningKey()) return null;
    return checkpointStore.createCheckpoint(ledger, { dir: CHECKPOINT_DIR });
  } catch (e) {
    console.error('auto-checkpoint failed (mutation still succeeded):', e.message);
    return null;
  }
}

/**
 * Resolve an exact TII, or a filesystem slug (tii_xxx), or a bare body.
 *
 * RFC 3986 §3.5 / the IANA `tii` registration
 * (https://www.iana.org/assignments/uri-schemes/prov/tii): "URI fragments
 * follow generic RFC 3986 URI-reference semantics and are not part of the
 * TII token." A trailing `#fragment` is stripped BEFORE lookup, via the
 * single shared src/tii-lookup.js splitFragment() primitive — see that
 * module's doc comment for why it is a shared module (this fragment-split
 * step used to be reimplemented separately here and in the static site's
 * client-side script, and drifted). This applies uniformly to whichever
 * identifier profile is in use (the 12-character test format or the
 * 26-character production format, src/id.js / src/identifier.js) —
 * resolution here is profile-agnostic string lookup, so one fragment-split
 * step correctly covers both.
 */
function resolveIdentifier(input) {
  if (!input) return null;
  const v = splitFragment(decodeURIComponent(input)).base.replace(/\.(html|json)$/, '');
  if (!v) return null;
  if (ledger.tiiExists(v)) return v;
  if (!v.startsWith('tii:')) {
    const withNs = 'tii:' + v.replace(/^tii[:_]?/, '');
    if (ledger.tiiExists(withNs)) return withNs;
  }
  for (const t of ledger.listTIIs()) if (tiiToFileSlug(t) === v.replace(/:/g, '_')) return t;
  return null;
}

function summariesForRegistry() {
  return ledger.listTIIs().map((tii) => exporters.publicSummary(project(ledger.forTII(tii))));
}

/* ---------------------------------------------------------------- routes --- */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, 'bad url');
  }
  let parts = url.pathname.split('/').filter(Boolean);
  const method = req.method.toUpperCase();

  // Language prefix (public HTML only). API / admin / export are not localized.
  let lang = 'en';
  if (parts[0] === 'ja') {
    lang = 'ja';
    parts = parts.slice(1);
  }

  try {
    /* ---- public HTML ---- */
    if (method === 'GET' && parts.length === 0) {
      return sendHTML(res, 200, views.homePage({ lang }));
    }

    if (method === 'GET' && parts[0] === 'registry' && parts.length === 1) {
      return sendHTML(res, 200, views.registryPage({ lang, summaries: summariesForRegistry() }));
    }

    // Machine-readable registry listing — parity with exporters.buildStaticSite()'s
    // catalog.json (src/export.js), which the deployed static mirror already
    // serves. The live dynamic server had no equivalent; same shape, same
    // publicSummary() fields, so a consumer gets identical data from either
    // deployment mode.
    if (method === 'GET' && parts[0] === 'catalog.json') {
      return sendJSON(res, 200, {
        generated_at: new Date().toISOString(),
        verification: ledger.verify(),
        checkpoint: checkpointStore.verifyCheckpoint(ledger, { dir: CHECKPOINT_DIR }),
        resolver_base: RESOLVER_BASE,
        identifiers: summariesForRegistry(),
      });
    }

    if (method === 'GET' && (parts[0] === 'spec' || parts[0] === 'about') && parts.length === 1) {
      const d = exporters.DOCS[parts[0]];
      return sendHTML(
        res,
        200,
        views.docPage({ lang, title: d.title[lang], path: d.path, markdown: exporters.readDoc(d[lang]) })
      );
    }

    if (method === 'GET' && parts[0] === 'audit' && parts.length === 1) {
      return sendHTML(
        res,
        200,
        views.auditPage({
          lang,
          verification: ledger.verify(),
          generatedAt: new Date().toISOString(),
          exportBase: '/export/ledger',
          checkpoint: checkpointStore.verifyCheckpoint(ledger, { dir: CHECKPOINT_DIR }),
        })
      );
    }

    if (method === 'GET' && parts[0] === 'resolve') {
      const found = resolveIdentifier(url.searchParams.get('tii'));
      if (found) return redirect(res, (lang === 'ja' ? '/ja' : '') + '/tii/' + tiiToFileSlug(found));
      return sendHTML(res, 404, views.resolutionPage({ lang, p: { exists: false, tii: url.searchParams.get('tii') } }));
    }

    /* ---- non-localized: spec.md, health, status ---- */
    if (method === 'GET' && parts[0] === 'spec.md') {
      return send(res, 200, exporters.readDoc('SPEC.md'), { 'Content-Type': 'text/markdown; charset=utf-8' });
    }
    if (method === 'GET' && parts[0] === 'healthz') {
      return sendJSON(res, 200, { ok: true, events: ledger.events.length });
    }

    // §35: every operational state reported independently — never one boolean.
    if (method === 'GET' && parts[0] === 'status' && parts.length === 1) {
      return sendJSON(
        res,
        200,
        statusModule.getOperationalStatus({
          ledgerFile: DATA_FILE,
          checkpointDir: CHECKPOINT_DIR,
          adminTokenConfigured: !!ADMIN_TOKEN,
        })
      );
    }

    // CLAIM A ONLY: internal chain integrity. Never conflated with claim B.
    if (method === 'GET' && parts[0] === 'verify') {
      const v = ledger.verify();
      const body = { claim: 'ledger_chain_integrity', status: v.ok ? 'VALID' : 'INVALID', ...v };
      if ((req.headers.accept || '').includes('application/json')) return sendJSON(res, 200, body);
      return sendHTML(
        res,
        200,
        views.auditPage({
          lang,
          verification: v,
          generatedAt: new Date().toISOString(),
          exportBase: '/export/ledger',
          checkpoint: checkpointStore.verifyCheckpoint(ledger, { dir: CHECKPOINT_DIR }),
        })
      );
    }

    // CLAIM B ONLY: signed checkpoint. Distinct route, distinct status vocabulary.
    //
    // ADVERSARIAL VERIFICATION FINDING (spec/phase1-adversarial-verification.md
    // §16, MEDIUM-HIGH): this route is deliberately UNAUTHENTICATED (checkpoint
    // verification is meant to be publicly checkable), which means the `file`
    // query param must never be allowed to name a path outside CHECKPOINT_DIR —
    // checkpointStore.verifyCheckpoint()'s `file` option is a trusted parameter
    // (the CLI legitimately passes arbitrary paths so an operator can verify an
    // externally-retrieved checkpoint copy — see spec/checkpoint-operation.md);
    // it is this PUBLIC ROUTE's job to restrict what untrusted callers may pass
    // through it, not verifyCheckpoint()'s. Only a bare filename (no path
    // separators, not absolute, no "..") is accepted; anything else is rejected
    // before it ever reaches the filesystem, closing what was previously an
    // unauthenticated file-existence oracle over the whole server filesystem.
    if (method === 'GET' && parts[0] === 'checkpoint' && parts[1] === 'verify') {
      const rawFile = url.searchParams.get('file');
      let fileParam;
      if (rawFile) {
        const base = path.basename(rawFile);
        if (base !== rawFile || rawFile === '.' || rawFile === '..') {
          return sendJSON(res, 400, { status: 'INVALID', reason: 'file must be a bare checkpoint filename within the checkpoint directory, not a path' });
        }
        fileParam = rawFile;
      }
      const result = checkpointStore.verifyCheckpoint(ledger, { dir: CHECKPOINT_DIR, file: fileParam });
      return sendJSON(res, result.status === 'VERIFIED' ? 200 : 200, result);
    }
    if (method === 'GET' && parts[0] === 'checkpoint' && parts[1] === 'list') {
      return sendJSON(res, 200, checkpointStore.listCheckpoints(CHECKPOINT_DIR));
    }

    /* ---- admin ---- */
    if (method === 'GET' && parts[0] === 'admin' && parts.length === 1) {
      return sendHTML(
        res,
        200,
        views.adminPage({ tiis: ledger.listTIIs(), tokenRequired: !!ADMIN_TOKEN, hashDirConfigured: !!ADMIN_HASH_DIR })
      );
    }

    /* ---- exports ---- */
    if (method === 'GET' && parts[0] === 'export') {
      const what = parts[1];
      if (what === 'ledger.jsonl')
        return send(res, 200, exporters.toJSONL(ledger), { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      if (what === 'ledger.json')
        return send(res, 200, exporters.toJSON(ledger), { 'Content-Type': 'application/json; charset=utf-8' });
      if (what === 'ledger.csv')
        return send(res, 200, exporters.toCSV(ledger), { 'Content-Type': 'text/csv; charset=utf-8' });
      if (what === 'static') {
        const out = path.join(__dirname, '..', 'dist');
        return sendJSON(res, 200, exporters.buildStaticSite(ledger, out, { resolverBase: RESOLVER_BASE }));
      }
      return send(res, 404, 'unknown export');
    }

    /* ---- API: create TII ---- */
    if (method === 'POST' && parts[0] === 'api' && parts[1] === 'tii' && parts.length === 2) {
      const body = parseBody(await readBody(req), req.headers['content-type']);
      if (!authorized(req, body.token)) return sendJSON(res, 401, { error: 'unauthorized', admin_availability: ADMIN_TOKEN ? 'ENABLED' : 'DISABLED' });
      const { tii, event, idempotent_replay } = ledger.issueTII({
        recorder: body.recorder || 'unspecified',
        content: jsonMaybe(body.content, {}),
        basis: jsonMaybe(body.basis, []),
        external_refs: jsonMaybe(body.external_refs, []),
        content_verification: jsonMaybe(body.content_verification, undefined),
        idempotency_key: idempotencyKeyFrom(req, body),
      });
      if (!idempotent_replay) maybeAutoCheckpoint();
      return sendJSON(res, idempotent_replay ? 200 : 201, { tii, event, idempotent_replay: !!idempotent_replay, resolve_url: `/tii/${encodeURIComponent(tii)}` });
    }

    /* ---- API: TII sub-resources ---- */
    if (parts[0] === 'api' && parts[1] === 'tii' && parts[2]) {
      const tii = decodeURIComponent(parts[2]);
      const sub = parts[3];

      if (method === 'POST' && sub === 'events') {
        const body = parseBody(await readBody(req), req.headers['content-type']);
        if (!authorized(req, body.token)) return sendJSON(res, 401, { error: 'unauthorized', admin_availability: ADMIN_TOKEN ? 'ENABLED' : 'DISABLED' });
        const event = ledger.append({
          tii,
          event_type: body.event_type,
          recorder: body.recorder || 'unspecified',
          recorded_at: body.recorded_at,
          content: jsonMaybe(body.content, {}),
          basis: jsonMaybe(body.basis, []),
          external_refs: jsonMaybe(body.external_refs, []),
          content_verification: jsonMaybe(body.content_verification, undefined),
          supersedes: body.supersedes || undefined,
          idempotency_key: idempotencyKeyFrom(req, body),
        });
        maybeAutoCheckpoint();
        return sendJSON(res, 201, { event });
      }

      if (method === 'GET') {
        const events = ledger.forTII(tii);
        if (events.length === 0) return sendJSON(res, 404, { error: 'unknown TII', tii });
        const p = project(events);
        if (!sub)
          return sendJSON(res, 200, {
            tii,
            identifier_status: p.identifier_status,
            lifecycle_state: p.lifecycle_state,
            last_recorded_at: p.last_recorded_at,
            event_count: p.event_count,
            disputes: p.disputes.length,
            disclaimer: p.disclaimer,
          });
        if (sub === 'events') return sendJSON(res, 200, { tii, events });
        if (sub === 'history') return sendJSON(res, 200, p);
        if (sub === 'relations')
          return sendJSON(res, 200, { tii, relations: p.modules.relation || [], series: p.modules.series || [] });
        if (sub === 'references') return sendJSON(res, 200, { tii, references: p.references });
        if (sub === 'data') return sendJSON(res, 200, p);
        return sendJSON(res, 404, { error: 'unknown sub-resource' });
      }
    }

    /* ---- resolution pages ---- */
    if (parts[0] === 'tii' && parts[1]) {
      const wantsJSON = parts[1].endsWith('.json') || parts[2] === 'data';
      const found = resolveIdentifier(parts[1]);
      const p = found ? project(ledger.forTII(found)) : { exists: false, tii: decodeURIComponent(parts[1]) };
      if (wantsJSON) return sendJSON(res, found ? 200 : 404, p);
      if (method === 'GET')
        return sendHTML(res, found ? 200 : 404, views.resolutionPage({ lang, p, resolverBase: RESOLVER_BASE }));
    }

    /* ---- admin form handlers ---- */
    if (method === 'POST' && parts[0] === 'admin') {
      const body = parseBody(await readBody(req), req.headers['content-type']);
      if (!authorized(req, body.token)) {
        return sendHTML(
          res,
          401,
          views.messagePage({
            title: 'Unauthorized',
            html: `<p>${ADMIN_TOKEN ? 'A valid write token is required.' : 'Admin is disabled — no TII_ADMIN_TOKEN is configured.'}</p>`,
          })
        );
      }

      if (parts[1] === 'issue') {
        const { tii, idempotent_replay } = ledger.issueTII({
          recorder: body.recorder || 'admin',
          content: body.note ? { tracking_started_note: body.note } : {},
          idempotency_key: body.idempotency_key || undefined,
        });
        if (!idempotent_replay) maybeAutoCheckpoint();
        return redirect(res, '/tii/' + tiiToFileSlug(tii));
      }

      if (parts[1] === 'hash-file') {
        try {
          const resolved = resolveSafeHashPath(body.path);
          const digest = sha256File(resolved);
          const snippet = JSON.stringify(
            { module: 'content', algo: 'sha256', value: digest, filename: path.basename(resolved) },
            null,
            2
          );
          return sendHTML(
            res,
            200,
            views.messagePage({
              title: 'SHA-256',
              html: `<p class="mono">${views.esc(path.relative(ADMIN_HASH_DIR, resolved))}</p><pre>${digest}</pre>
<p>Paste into a <code>content.hash.recorded</code> event:</p><pre>${views.esc(snippet)}</pre>
<p><a href="/admin">← Admin</a></p>`,
            })
          );
        } catch (e) {
          return sendHTML(res, 400, views.messagePage({ title: 'Hash failed', html: `<pre>${views.esc(e.message)}</pre><p><a href="/admin">← Admin</a></p>` }));
        }
      }

      if (parts[1] === 'event') {
        try {
          const event = ledger.append({
            tii: body.tii,
            event_type: body.event_type,
            recorder: body.recorder || 'admin',
            content: jsonMaybe(body.content, {}),
            basis: jsonMaybe(body.basis, []),
            external_refs: jsonMaybe(body.external_refs, []),
            content_verification: jsonMaybe(body.content_verification, undefined),
            supersedes: body.supersedes || undefined,
            idempotency_key: body.idempotency_key || undefined,
          });
          maybeAutoCheckpoint();
          return redirect(res, '/tii/' + tiiToFileSlug(event.tii));
        } catch (e) {
          return sendHTML(
            res,
            400,
            views.messagePage({ title: 'Append failed', html: `<pre>${views.esc(e.message)}</pre><p><a href="/admin">← Admin</a></p>` })
          );
        }
      }
      return send(res, 404, 'unknown admin action');
    }

    return sendHTML(res, 404, views.notFoundPage({ lang }));
  } catch (err) {
    // recovery-required / writer-locked are operational-availability conditions,
    // not client input errors — 503, and never silently downgraded to a 200.
    const status = err.code === 'recovery-required' || err.code === 'writer-locked' ? 503 : err.code === 'no-signing-key' ? 409 : 400;
    return sendJSON(res, status, { error: err.message, code: err.code });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`TII listening on http://localhost:${PORT}`);
    console.log(`  ledger: ${DATA_FILE}  (${ledger.events.length} events)`);
    console.log(`  write token: ${ADMIN_TOKEN ? 'required (admin enabled)' : 'NOT SET — admin DISABLED (fail closed)'}`);
    console.log(`  admin hash-file: ${ADMIN_HASH_DIR ? 'enabled, restricted to ' + ADMIN_HASH_DIR : 'disabled'}`);
    console.log(`  checkpoint signing key: ${checkpointStore.resolveSigningKey() ? 'configured' : 'NOT configured — checkpoint creation will fail closed'}`);
    console.log(`  checkpoint dir: ${CHECKPOINT_DIR}`);
    console.log(`  resolver base: ${RESOLVER_BASE || '(relative)'}`);
    console.log(`  production issuance: DISABLED`);
  });
}

module.exports = { server, ledger };
