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
// Public, unauthenticated, test-identifier-only self-service issuance.
// Off by default — strict boolean parsing, matching src/production-gate.js's
// convention (`=== 'true'` only, never truthy-string coercion). This is
// structurally separate from the gated production-only issuance module
// (src/ledger.js's issueTII() only, always identifier_status "test") and
// is not gated by or capable of touching src/production-gate.js in any way.
const SELF_SERVICE_ENABLED = process.env.TII_SELF_SERVICE_ENABLED === 'true';
const SELF_SERVICE_RATE_LIMIT_MAX = Number(process.env.TII_SELF_SERVICE_RATE_LIMIT_MAX || 5);
const SELF_SERVICE_RATE_LIMIT_WINDOW_MS = Number(process.env.TII_SELF_SERVICE_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const SELF_SERVICE_NOTE_MAX_LENGTH = 280;
// Deployment-readiness hardening (post-issuance, self-service-deployment
// phase). A separate, deterministic global cap across ALL callers, distinct
// from the per-IP limiter above. In-process only — defense-in-depth for v1;
// a real deployment still needs CDN/reverse-proxy-level abuse protection,
// since this state is neither shared across instances nor durable across a
// restart.
const SELF_SERVICE_GLOBAL_QUOTA_MAX = Number(process.env.TII_SELF_SERVICE_GLOBAL_QUOTA_MAX || 200);
const SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS = Number(process.env.TII_SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS || 60 * 60 * 1000);
// Storage ceiling checked before accepting a self-service issuance — belt
// and suspenders alongside the rate limiters above, bounding worst-case
// ledger growth even if both limiters are configured generously.
const SELF_SERVICE_MAX_LEDGER_BYTES = Number(process.env.TII_SELF_SERVICE_MAX_LEDGER_BYTES || 50 * 1024 * 1024);
const SELF_SERVICE_MAX_EVENT_COUNT = Number(process.env.TII_SELF_SERVICE_MAX_EVENT_COUNT || 100000);
// Route-specific request body ceiling, well below the generic 5MB default in
// readBody() — a self-service issuance body is a short note, never a bulk
// payload.
const SELF_SERVICE_MAX_BODY_BYTES = 2048;
// Human-readable registry label shown on TEST resolution pages once an
// operator configures it (Phase 11). Empty by default, so an ordinary
// deployment's resolution pages are byte-for-byte unchanged.
const REGISTRY_LABEL = process.env.TII_REGISTRY_LABEL || '';

// ---- deployment-mode boundary ----
// The smallest possible boundary distinguishing an ordinary/local server
// process from a public, unauthenticated TEST self-service deployment. This
// flag can only ever REMOVE or RESTRICT capability relative to the default
// (see every site below that checks PUBLIC_SELF_SERVICE_MODE) — it never
// grants one, and in particular it can never enable production issuance.
const DEPLOYMENT_MODE = process.env.TII_DEPLOYMENT_MODE || 'default';
const PUBLIC_SELF_SERVICE_MODE = DEPLOYMENT_MODE === 'public-self-service';

// The repository's own default ledger/checkpoint locations, used only as a
// comparison target so public-self-service mode can refuse to run against
// them. Computed independently of DATA_FILE/CHECKPOINT_DIR (which already
// apply any TII_LEDGER / TII_CHECKPOINT_DIR override), so the comparison
// stays meaningful regardless of what an operator has configured.
const REPO_DEFAULT_LEDGER_FILE = path.join(__dirname, '..', 'data', 'ledger.jsonl');
const REPO_DEFAULT_CHECKPOINT_DIR = path.join(__dirname, '..', 'checkpoints');

/**
 * True if two filesystem paths name the same location: lexical resolution
 * first, then realpath (for whichever side already exists on disk), so a
 * symlinked alias of a rejected path is also caught. Never throws — a path
 * that does not exist yet simply compares by its lexical resolution alone,
 * since there is nothing for realpath to follow.
 */
function samePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  let realA = ra;
  let realB = rb;
  try { realA = fs.realpathSync(ra); } catch { /* does not exist yet -- lexical comparison stands */ }
  try { realB = fs.realpathSync(rb); } catch { /* does not exist yet -- lexical comparison stands */ }
  return realA === realB;
}

/**
 * Startup-time (module-load-time), fail-closed validation for
 * 'public-self-service' deployment mode. Throws a plain Error rather than
 * calling process.exit(), so it (a) crashes real server startup naturally
 * via the resulting uncaught exception, and (b) is directly testable with
 * assert.throws(() => require('../src/server')) — the same require-cache-
 * busting boot convention already used throughout this project's test
 * suite. Runs before the Ledger is constructed below, so a rejected
 * configuration never even opens a ledger file.
 *
 * This function only ever narrows what can start; it never widens it. It
 * deliberately does not attempt to distinguish a "production" signing key
 * from a "TEST" one by inspecting key material — that distinction is not
 * decidable from the bytes alone. Instead, checkpoint signing is
 * unconditionally disabled in this mode regardless of what key material
 * happens to be configured (see maybeAutoCheckpoint()), which makes the key
 * material question moot rather than attempting to answer it.
 */
function validatePublicSelfServiceDeployment() {
  if (!PUBLIC_SELF_SERVICE_MODE) return;

  if (!process.env.TII_LEDGER) {
    throw new Error(
      'TII_DEPLOYMENT_MODE=public-self-service requires an explicit TII_LEDGER path; no default ledger location is used in this mode.'
    );
  }
  if (samePath(DATA_FILE, REPO_DEFAULT_LEDGER_FILE)) {
    throw new Error(
      'TII_DEPLOYMENT_MODE=public-self-service refuses to run against the repository default ledger path (or a path resolving to it). Configure TII_LEDGER to a dedicated, disposable TEST ledger file.'
    );
  }

  if (!process.env.TII_CHECKPOINT_DIR) {
    throw new Error(
      "TII_DEPLOYMENT_MODE=public-self-service requires an explicit TII_CHECKPOINT_DIR; no default checkpoint directory is used in this mode, so that read-only checkpoint routes cannot resolve to the repository's own checkpoint state either."
    );
  }
  if (samePath(CHECKPOINT_DIR, REPO_DEFAULT_CHECKPOINT_DIR)) {
    throw new Error(
      'TII_DEPLOYMENT_MODE=public-self-service refuses to run against the repository default checkpoint directory (or a path resolving to it). Configure TII_CHECKPOINT_DIR to a dedicated TEST-only directory.'
    );
  }
}

validatePublicSelfServiceDeployment();
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
const sendJSON = (res, s, o, headers = {}) =>
  send(res, s, JSON.stringify(o, null, 2), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
const sendHTML = (res, s, h) => send(res, s, h, { 'Content-Type': 'text/html; charset=utf-8' });
const redirect = (res, loc) => {
  res.writeHead(302, { Location: loc });
  res.end();
};

/**
 * Read a request body up to maxBytes. Enforced BEFORE unbounded buffering in
 * two ways: (1) a Content-Length that already declares more than the limit
 * is rejected without reading any body bytes at all; (2) if the client lies
 * about Content-Length (or omits it) and streams more than maxBytes anyway,
 * reading stops and the socket is torn down the moment the limit is
 * crossed — the excess is never buffered and no truncated body is ever
 * silently returned as success. Rejection carries `.code = 'payload-too-large'`
 * so the caller can map it to an HTTP 413, distinct from a generic 400.
 */
function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      const err = new Error(`request body exceeds the ${maxBytes}-byte limit for this route`);
      err.code = 'payload-too-large';
      return err;
    };

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      reject(tooLarge());
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.destroy();
      reject(err);
    };
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > maxBytes) {
        fail(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => fail(e));
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

// Client IP resolution used for self-service rate limiting only — never a
// security boundary. By default (TII_TRUSTED_PROXY_HEADER unset) NO proxy
// header is trusted at all, and only the actual TCP peer address is used —
// a client with no trusted reverse proxy in front of this server cannot
// spoof its way past the per-IP limiter. An operator running behind exactly
// one reverse proxy may opt in to trusting a single named header, chosen
// from a small reviewed allowlist rather than an arbitrary string (so a
// misconfiguration can't accidentally trust something like `x-real-ip` on a
// deployment that never sets it, and so this never hardwires one specific
// CDN vendor).
const TRUSTED_PROXY_HEADER_ALLOWLIST = new Set(['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip']);
const TRUSTED_PROXY_HEADER = (() => {
  const raw = process.env.TII_TRUSTED_PROXY_HEADER;
  if (!raw) return '';
  const normalized = raw.trim().toLowerCase();
  if (!TRUSTED_PROXY_HEADER_ALLOWLIST.has(normalized)) {
    throw new Error(
      `TII_TRUSTED_PROXY_HEADER=${JSON.stringify(raw)} is not one of the supported header names: ${[...TRUSTED_PROXY_HEADER_ALLOWLIST].join(', ')}`
    );
  }
  return normalized;
})();

/**
 * A conservative shape check, not a full IPv4/IPv6 validator — its only job
 * is to reject values that are obviously not a single address (a
 * comma-separated multi-hop chain, embedded whitespace, an empty string) so
 * a malformed or spoofed multi-value header falls back to the socket
 * address rather than being trusted as-is.
 */
function isPlausibleIp(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.includes(',') || /\s/.test(v)) return false;
  return /^[0-9a-fA-F.:]+$/.test(v);
}

/**
 * Best-effort client IP for self-service rate limiting only — NOT a security
 * boundary even when a trusted proxy header is configured (the consequence
 * of a limiter miss here is bounded: a throttling gap on a public endpoint
 * that can only ever mint a `test` identifier, never anything touching
 * production issuance, the gate, or a signing key). Do not reuse this
 * function anywhere a genuine security decision depends on the caller's
 * real address.
 */
function selfServiceClientIp(req) {
  const socketIp = req.socket.remoteAddress || 'unknown';
  if (!TRUSTED_PROXY_HEADER) return socketIp;
  const headerValue = req.headers[TRUSTED_PROXY_HEADER];
  if (typeof headerValue !== 'string') return socketIp;
  return isPlausibleIp(headerValue) ? headerValue.trim() : socketIp;
}

/** In-memory sliding-window rate limiter, keyed by selfServiceClientIp().
 * Deliberately simple (no external dependency, per this project's zero-
 * dependency constraint) and deliberately per-process — a multi-instance
 * deployment would not share state across instances, which only makes the
 * limit less strict, never less safe (the endpoint remains
 * test-identifier-only regardless of how often it is called). */
const selfServiceRateLimitState = new Map(); // ip -> timestamps[] within the current window
function selfServiceRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - SELF_SERVICE_RATE_LIMIT_WINDOW_MS;
  const recent = (selfServiceRateLimitState.get(ip) || []).filter((t) => t > windowStart);
  if (recent.length >= SELF_SERVICE_RATE_LIMIT_MAX) {
    selfServiceRateLimitState.set(ip, recent);
    return { limited: true, retryAfterMs: Math.max(0, recent[0] + SELF_SERVICE_RATE_LIMIT_WINDOW_MS - now) };
  }
  recent.push(now);
  selfServiceRateLimitState.set(ip, recent);
  return { limited: false };
}

/**
 * Deterministic in-process global cap across ALL self-service callers,
 * independent of the per-IP limiter above. Fails closed once exhausted
 * (returns `exceeded: true` with a Retry-After hint) and — like the per-IP
 * limiter — never counts a call that was itself rejected: the timestamp is
 * only pushed on the success path, so a caller turned away by this same
 * check does not further shrink the window for others. In-process only —
 * acceptable defense-in-depth for v1, but not a substitute for CDN/reverse-
 * proxy-level rate limiting in a real deployment, since neither this nor the
 * per-IP limiter shares state across instances or survives a restart.
 */
let selfServiceGlobalQuotaTimestamps = [];
function selfServiceGlobalQuotaExceeded() {
  const now = Date.now();
  const windowStart = now - SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS;
  selfServiceGlobalQuotaTimestamps = selfServiceGlobalQuotaTimestamps.filter((t) => t > windowStart);
  if (selfServiceGlobalQuotaTimestamps.length >= SELF_SERVICE_GLOBAL_QUOTA_MAX) {
    return {
      exceeded: true,
      retryAfterMs: Math.max(0, selfServiceGlobalQuotaTimestamps[0] + SELF_SERVICE_GLOBAL_QUOTA_WINDOW_MS - now),
    };
  }
  selfServiceGlobalQuotaTimestamps.push(now);
  return { exceeded: false };
}

/**
 * Storage ceiling checked before accepting a self-service issuance, using
 * only the existing Ledger's own loaded state and a plain fs.statSync of the
 * ledger file — never a second, hand-rolled parse of the ledger contents.
 * Fails closed (treats the state as "exceeded") whenever the current size
 * cannot be determined for any reason other than the file simply not
 * existing yet (a brand-new, empty ledger is unambiguously under quota).
 */
function selfServiceStorageQuotaExceeded() {
  let stat;
  try {
    stat = fs.statSync(DATA_FILE);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    return true; // unreadable for any other reason -- fail closed
  }
  if (stat.size >= SELF_SERVICE_MAX_LEDGER_BYTES) return true;
  if (ledger.events.length >= SELF_SERVICE_MAX_EVENT_COUNT) return true;
  return false;
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
  // Public self-service deployment mode never signs a checkpoint,
  // unconditionally — regardless of whatever key material happens to be
  // configured in the environment. There is no TEST-only checkpoint-signing
  // configuration yet; until one exists, this is the only way to guarantee
  // this mode neither requires nor can be made to use production key
  // material, and that it never touches the checkpoint directory as a write
  // target.
  if (PUBLIC_SELF_SERVICE_MODE) return null;
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
      return sendHTML(res, 200, views.homePage({ lang, selfServiceEnabled: SELF_SERVICE_ENABLED }));
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
    // Read-only. Never issues, appends, signs, satisfies the production
    // gate, reveals secrets, or dumps ledger content — only counts and
    // booleans. deployment_mode_configured_correctly re-runs the same
    // startup-time check that would otherwise have prevented this process
    // from ever reaching a running state at all, so it is a confirmatory
    // signal for monitoring, not a gate this route itself enforces.
    if (method === 'GET' && parts[0] === 'healthz') {
      let ledgerReadable = true;
      let chainValid = false;
      try {
        chainValid = !!ledger.verify().ok;
      } catch {
        ledgerReadable = false;
      }
      let deploymentModeConfiguredCorrectly = true;
      try {
        validatePublicSelfServiceDeployment();
      } catch {
        deploymentModeConfiguredCorrectly = false;
      }
      const healthy = ledgerReadable && chainValid && deploymentModeConfiguredCorrectly;
      return sendJSON(res, healthy ? 200 : 503, {
        ok: healthy,
        process_alive: true,
        ledger_readable: ledgerReadable,
        chain_valid: chainValid,
        deployment_mode: DEPLOYMENT_MODE,
        deployment_mode_configured_correctly: deploymentModeConfiguredCorrectly,
        events: ledger.events.length,
      });
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
      // registry_status: public, non-secret metadata only — no production
      // verification material (key, checkpoint, gate state) is loaded to
      // answer this. self_service_test_registry is true precisely when this
      // process could ever mint a `test` identifier via the public
      // self-service route, regardless of whether it currently has capacity.
      const body = {
        claim: 'ledger_chain_integrity',
        status: v.ok ? 'VALID' : 'INVALID',
        ...v,
        registry_status: {
          deployment_mode: DEPLOYMENT_MODE,
          self_service_test_registry: SELF_SERVICE_ENABLED,
          registry_label: REGISTRY_LABEL || null,
        },
      };
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

    /* ---- admin ----
     * In public-self-service deployment mode, the application itself fails
     * closed for every admin route (GET and, further below, every POST
     * admin action) — not merely a documented operational recommendation
     * that a future reverse proxy is expected to enforce. Ordinary/local
     * deployments are unaffected: this check only ever removes
     * functionality relative to today's default, and only in the one mode
     * that opts into it. */
    if (method === 'GET' && parts[0] === 'admin' && parts.length === 1) {
      if (PUBLIC_SELF_SERVICE_MODE) return sendHTML(res, 404, views.notFoundPage({ lang }));
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

    /* ---- public self-service: test-identifier issuance only ----
     * Deliberately separate from the admin-token-gated /api/tii route below
     * (never reuses its authorization check — this route has none, by
     * design) and structurally incapable of touching production issuance:
     * it calls ONLY ledger.issueTII() with no `identifier_status` override
     * (always "test"), never imports or can reach the gated production-only
     * issuance module or src/production-gate.js. Off unless
     * TII_SELF_SERVICE_ENABLED=true;
     * rate-limited per client IP (best-effort only, see
     * selfServiceClientIp()'s doc comment); note length capped to bound
     * storage growth from a public unauthenticated endpoint. */
    if (method === 'POST' && parts[0] === 'self-service' && parts[1] === 'issue' && parts.length === 2) {
      if (!SELF_SERVICE_ENABLED) {
        return sendJSON(res, 404, { error: 'self-service issuance is not enabled on this deployment' });
      }
      const gq = selfServiceGlobalQuotaExceeded();
      if (gq.exceeded) {
        return sendJSON(
          res,
          429,
          { error: 'global issuance quota exhausted for this window', retry_after_ms: gq.retryAfterMs },
          { 'Retry-After': String(Math.ceil(gq.retryAfterMs / 1000)) }
        );
      }
      const ip = selfServiceClientIp(req);
      const rl = selfServiceRateLimited(ip);
      if (rl.limited) {
        return sendJSON(
          res,
          429,
          { error: 'rate limit exceeded', retry_after_ms: rl.retryAfterMs },
          { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }
        );
      }
      if (selfServiceStorageQuotaExceeded()) {
        return sendJSON(res, 503, { error: 'self-service issuance storage quota exhausted on this deployment' });
      }
      const body = parseBody(await readBody(req, SELF_SERVICE_MAX_BODY_BYTES), req.headers['content-type']);
      let content = {};
      if (typeof body.note === 'string' && body.note.length > 0) {
        if (body.note.length > SELF_SERVICE_NOTE_MAX_LENGTH) {
          return sendJSON(res, 400, { error: `note must be at most ${SELF_SERVICE_NOTE_MAX_LENGTH} characters` });
        }
        content = { note: body.note };
      }
      const { tii, event, idempotent_replay } = ledger.issueTII({
        recorder: { id: 'self-service', kind: 'mechanism' },
        content,
        idempotency_key: idempotencyKeyFrom(req, body),
      });
      if (!idempotent_replay) maybeAutoCheckpoint();
      return sendJSON(res, idempotent_replay ? 200 : 201, {
        tii,
        event,
        identifier_status: 'test',
        idempotent_replay: !!idempotent_replay,
        resolve_url: `/tii/${encodeURIComponent(tii)}`,
      });
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
        return sendHTML(res, found ? 200 : 404, views.resolutionPage({ lang, p, resolverBase: RESOLVER_BASE, registryLabel: REGISTRY_LABEL }));
    }

    /* ---- admin form handlers ---- */
    if (method === 'POST' && parts[0] === 'admin') {
      if (PUBLIC_SELF_SERVICE_MODE) return sendHTML(res, 404, views.notFoundPage({ lang }));
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
    const status =
      err.code === 'recovery-required' || err.code === 'writer-locked'
        ? 503
        : err.code === 'no-signing-key'
          ? 409
          : err.code === 'payload-too-large'
            ? 413
            : 400;
    return sendJSON(res, status, { error: err.message, code: err.code });
  }
});

// Conservative Node-native HTTP timeouts — no new dependency, applied
// unconditionally. A local/dev server is not meaningfully worse off with
// these set; a public deployment needs them.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`TII listening on http://localhost:${PORT}`);
    console.log(`  deployment mode: ${DEPLOYMENT_MODE}${PUBLIC_SELF_SERVICE_MODE ? ' (public self-service TEST deployment)' : ''}`);
    console.log(`  ledger: ${DATA_FILE}  (${ledger.events.length} events)`);
    console.log(`  write token: ${ADMIN_TOKEN ? 'required (admin enabled)' : 'NOT SET — admin DISABLED (fail closed)'}`);
    console.log(`  admin routes: ${PUBLIC_SELF_SERVICE_MODE ? 'DISABLED (public self-service deployment mode)' : 'available, subject to write token above'}`);
    console.log(`  admin hash-file: ${ADMIN_HASH_DIR ? 'enabled, restricted to ' + ADMIN_HASH_DIR : 'disabled'}`);
    console.log(`  checkpoint signing key: ${PUBLIC_SELF_SERVICE_MODE ? 'DISABLED in this mode (never checked)' : checkpointStore.resolveSigningKey() ? 'configured' : 'NOT configured — checkpoint creation will fail closed'}`);
    console.log(`  checkpoint dir: ${CHECKPOINT_DIR}`);
    console.log(`  resolver base: ${RESOLVER_BASE || '(relative)'}`);
    console.log(`  production issuance: DISABLED`);
  });

  // Clean shutdown on SIGTERM/SIGINT (Phase 14 — required for a container
  // orchestrator's normal stop signal to be handled, not just killed):
  // stop accepting new connections and let in-flight requests finish, then
  // exit. A single authoritative write (Ledger.append/issueTII) is a
  // synchronous filesystem operation guarded by the writer lock, so there is
  // no async "write in flight" state this needs to wait out beyond the HTTP
  // response itself. A bounded force-exit guards against a connection that
  // never closes (e.g. an idle keep-alive client) hanging shutdown forever.
  const shutdown = (signal) => {
    console.log(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { server, ledger };
