'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

const { Ledger } = require('./ledger');
const { project } = require('./projection');
const { sha256File } = require('./hash');
const { tiiToFileSlug } = require('./id');
const { normalizeLang } = require('./i18n');
const views = require('./views');
const exporters = require('./export');

const DATA_FILE = process.env.TII_LEDGER || path.join(__dirname, '..', 'data', 'ledger.jsonl');
const PORT = Number(process.env.PORT || process.env.TII_PORT || 3009);
const ADMIN_TOKEN = process.env.TII_ADMIN_TOKEN || '';
const RESOLVER_BASE = process.env.TII_RESOLVER_BASE_URL || '';

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

function authorized(req, bodyToken) {
  if (!ADMIN_TOKEN) return true;
  const header =
    req.headers['x-tii-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return header === ADMIN_TOKEN || bodyToken === ADMIN_TOKEN;
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

/** Resolve an exact TII, or a filesystem slug (tii_xxx), or a bare body. */
function resolveIdentifier(input) {
  if (!input) return null;
  let v = decodeURIComponent(input).replace(/\.(html|json)$/, '').trim().toLowerCase();
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
        })
      );
    }

    if (method === 'GET' && parts[0] === 'resolve') {
      const found = resolveIdentifier(url.searchParams.get('tii'));
      if (found) return redirect(res, (lang === 'ja' ? '/ja' : '') + '/tii/' + tiiToFileSlug(found));
      return sendHTML(res, 404, views.resolutionPage({ lang, p: { exists: false, tii: url.searchParams.get('tii') } }));
    }

    /* ---- non-localized: spec.md, health ---- */
    if (method === 'GET' && parts[0] === 'spec.md') {
      return send(res, 200, exporters.readDoc('SPEC.md'), { 'Content-Type': 'text/markdown; charset=utf-8' });
    }
    if (method === 'GET' && parts[0] === 'healthz') {
      return sendJSON(res, 200, { ok: true, events: ledger.events.length });
    }
    if (method === 'GET' && parts[0] === 'verify') {
      const v = ledger.verify();
      if ((req.headers.accept || '').includes('application/json')) return sendJSON(res, 200, v);
      return sendHTML(res, 200, views.auditPage({ lang, verification: v, generatedAt: new Date().toISOString(), exportBase: '/export/ledger' }));
    }

    /* ---- admin ---- */
    if (method === 'GET' && parts[0] === 'admin' && parts.length === 1) {
      return sendHTML(res, 200, views.adminPage({ tiis: ledger.listTIIs(), tokenRequired: !!ADMIN_TOKEN }));
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
      if (!authorized(req, body.token)) return sendJSON(res, 401, { error: 'unauthorized' });
      const { tii, event } = ledger.issueTII({
        recorder: body.recorder || 'unspecified',
        content: jsonMaybe(body.content, {}),
        basis: jsonMaybe(body.basis, []),
        external_refs: jsonMaybe(body.external_refs, []),
        content_verification: jsonMaybe(body.content_verification, undefined),
      });
      return sendJSON(res, 201, { tii, event, resolve_url: `/tii/${encodeURIComponent(tii)}` });
    }

    /* ---- API: TII sub-resources ---- */
    if (parts[0] === 'api' && parts[1] === 'tii' && parts[2]) {
      const tii = decodeURIComponent(parts[2]);
      const sub = parts[3];

      if (method === 'POST' && sub === 'events') {
        const body = parseBody(await readBody(req), req.headers['content-type']);
        if (!authorized(req, body.token)) return sendJSON(res, 401, { error: 'unauthorized' });
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
        });
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
      if (!authorized(req, body.token))
        return sendHTML(res, 401, views.messagePage({ title: 'Unauthorized', html: '<p>A write token is required.</p>' }));

      if (parts[1] === 'issue') {
        const { tii } = ledger.issueTII({
          recorder: body.recorder || 'admin',
          content: body.note ? { tracking_started_note: body.note } : {},
        });
        return redirect(res, '/tii/' + tiiToFileSlug(tii));
      }

      if (parts[1] === 'hash-file') {
        try {
          const digest = sha256File(body.path);
          const snippet = JSON.stringify(
            { module: 'content', algo: 'sha256', value: digest, filename: path.basename(body.path) },
            null,
            2
          );
          return sendHTML(
            res,
            200,
            views.messagePage({
              title: 'SHA-256',
              html: `<p class="mono">${views.esc(body.path)}</p><pre>${digest}</pre>
<p>Paste into a <code>content.hash.recorded</code> event:</p><pre>${views.esc(snippet)}</pre>
<p><a href="/admin">← Admin</a></p>`,
            })
          );
        } catch (e) {
          return sendHTML(res, 400, views.messagePage({ title: 'Hash failed', html: `<pre>${views.esc(e.message)}</pre>` }));
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
          });
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
    return sendJSON(res, 400, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`TII listening on http://localhost:${PORT}`);
    console.log(`  ledger: ${DATA_FILE}  (${ledger.events.length} events)`);
    console.log(`  write token: ${ADMIN_TOKEN ? 'required' : 'not set (single-admin local mode)'}`);
    console.log(`  resolver base: ${RESOLVER_BASE || '(relative)'}`);
  });
}

module.exports = { server, ledger };
