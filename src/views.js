'use strict';

const labels = require('./labels');
const { tiiToFileSlug } = require('./id');
const { splitFragment } = require('./tii-lookup');
const { t, normalizeLang, humanizeEventType, recordStatusLabel, formatDate } = require('./i18n');
const { displayContent } = require('./projection');
const { renderMarkdown } = require('./md');

const SOURCE_REPO = process.env.TII_SOURCE_REPO || 'https://github.com/n-fujie/TII';
const SPEC_VERSION = '0.1';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Language-aware internal href. `p` is the canonical (English) path. */
function href(lang, p) {
  if (p.startsWith('http')) return p;
  if (lang === 'ja') return p === '/' ? '/ja' : '/ja' + p;
  return p;
}

const STYLE = `
*{box-sizing:border-box}
:root{
  --bg:#ffffff; --ink:#151515; --muted:#5c5c5c; --faint:#8a8a8a;
  --line:#e6e6e6; --line-strong:#c8c8c8;
  --accent:#0b3d91; --accent-ink:#082f70; --accent-bg:#eef2fb;
  --warn-ink:#8a5300; --warn-line:#d9b26a; --warn-bg:#fdf6ec;
  --serif:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:44rem;margin:0 auto;padding:0 1.25rem}
.wrap.wide{max-width:62rem}

.siteheader{border-bottom:1px solid var(--line)}
.siteheader .wrap{display:flex;align-items:center;gap:1.25rem;padding-top:.9rem;padding-bottom:.9rem}
.brand{display:flex;align-items:baseline;gap:.5rem;white-space:nowrap}
.brand .mark{font-family:var(--serif);font-weight:700;font-size:1.2rem;letter-spacing:.02em;color:var(--ink)}
.brand .sub{font-size:.72rem;color:var(--faint);letter-spacing:.02em}
.siteheader nav{margin-left:auto;display:flex;gap:1.1rem;flex-wrap:wrap;font-size:.9rem}
.siteheader nav a{color:var(--ink)}
.siteheader nav a[aria-current]{color:var(--accent);font-weight:600}
.lang{font-size:.82rem;color:var(--faint);white-space:nowrap}
.lang a{color:var(--muted)}
@media(max-width:46rem){
  .siteheader .wrap{flex-wrap:wrap;gap:.55rem 1rem}
  .brand{order:1}
  .lang{order:2;margin-left:auto}
  .siteheader nav{order:3;width:100%;margin-left:0;gap:.6rem 1.1rem}
}
@media(max-width:24rem){.brand .sub{display:none}}

main{padding:2.6rem 0 3rem}
h1{font-family:var(--serif);font-weight:700;font-size:1.7rem;line-height:1.25;margin:0 0 .6rem}
h2{font-family:var(--serif);font-weight:700;font-size:1.18rem;margin:2.4rem 0 .7rem;
  padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1rem;margin:1.4rem 0 .4rem}
p{margin:.7rem 0}
.muted{color:var(--muted)}
.small{font-size:.86rem}
.mono{font-family:var(--mono)}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}

.hero{padding:1rem 0 .5rem}
.hero .mark-lg{font-family:var(--serif);font-weight:700;font-size:3rem;line-height:1;letter-spacing:.01em}
.hero .sub-lg{font-family:var(--serif);font-size:1.15rem;color:var(--ink);margin-top:.35rem}
.spec-status{display:inline-block;margin-top:.8rem;font-size:.75rem;letter-spacing:.06em;
  text-transform:uppercase;color:var(--muted);border:1px solid var(--line-strong);
  border-radius:2px;padding:.15rem .5rem}
.lead{font-size:1.1rem;line-height:1.55;margin:1.4rem 0 1.6rem;max-width:36rem}

form.resolve{display:flex;gap:.5rem;max-width:34rem;margin:1.2rem 0 0}
form.resolve input{flex:1;font-family:var(--mono);font-size:.95rem;padding:.6rem .7rem;
  border:1px solid var(--line-strong);border-radius:2px;background:#fff;color:var(--ink)}
form.resolve input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.btn,form.resolve button{font-family:var(--sans);font-size:.95rem;padding:.6rem 1.1rem;
  border:1px solid var(--accent);border-radius:2px;background:var(--accent);color:#fff;cursor:pointer}
.btn:hover,form.resolve button:hover{background:var(--accent-ink);text-decoration:none}
.btn.secondary{background:#fff;color:var(--accent)}

section.self-service{margin:1.6rem 0;padding:1rem 1.2rem;border:1px solid var(--line-strong);border-radius:4px;max-width:34rem}
section.self-service h2{font-size:1rem;margin:0 0 .4rem}
form.self-service-form{display:flex;gap:.5rem;margin:.8rem 0 0}
form.self-service-form input{flex:1;font-family:var(--sans);font-size:.9rem;padding:.55rem .7rem;
  border:1px solid var(--line-strong);border-radius:2px;background:#fff;color:var(--ink)}
form.self-service-form button{font-family:var(--sans);font-size:.9rem;padding:.55rem 1rem;
  border:1px solid var(--accent);border-radius:2px;background:var(--accent);color:#fff;cursor:pointer}
form.self-service-form button:disabled{opacity:.6;cursor:default}
.self-service-result{font-family:var(--mono);font-size:.85rem;margin:.6rem 0 0;min-height:1.2em}

ul.home-links{list-style:none;padding:0;margin:2rem 0;border-top:1px solid var(--line)}
ul.home-links li{border-bottom:1px solid var(--line)}
ul.home-links li a{display:block;padding:.85rem 0;color:var(--ink)}
ul.home-links li a:hover{color:var(--accent);text-decoration:none}

table{border-collapse:collapse;width:100%;font-size:.9rem;margin:.6rem 0}
th{text-align:left;font-weight:600;border-bottom:2px solid var(--line-strong);padding:.5rem .6rem}
td{border-bottom:1px solid var(--line);padding:.5rem .6rem;vertical-align:top}
.table-scroll{overflow-x:auto}
tr:hover td{background:#fafafa}

.tag{display:inline-block;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);
  border-radius:2px;padding:.1rem .4rem;white-space:nowrap}
.chip{display:inline-block;font-size:.75rem;color:var(--muted);border:1px solid var(--line-strong);
  border-radius:2px;padding:.05rem .4rem;margin-right:.3rem}
.chip.warn{color:var(--warn-ink);border-color:var(--warn-line)}

dl.kv{margin:.8rem 0;display:grid;grid-template-columns:12rem 1fr;gap:.1rem .8rem}
dl.kv dt{color:var(--muted);font-size:.9rem;padding:.35rem 0}
dl.kv dd{margin:0;padding:.35rem 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
dl.kv dt{border-bottom:1px solid var(--line)}
@media(max-width:34rem){dl.kv{grid-template-columns:1fr}dl.kv dt{border-bottom:0;padding-bottom:0}}

nav.toc{margin:1.2rem 0 0;font-size:.9rem;display:flex;flex-wrap:wrap;gap:.2rem .9rem}
nav.toc a{color:var(--muted)}

.idbox{font-family:var(--mono);font-size:1.1rem;word-break:break-all;margin:.2rem 0 .6rem}
.record{border:1px solid var(--line);border-radius:3px;padding:.8rem 1rem;margin:.7rem 0}
.record .ref{font-family:var(--mono);font-size:.82rem;color:var(--muted)}
details{margin:.5rem 0}summary{cursor:pointer;color:var(--accent);font-size:.9rem}
pre{background:#f6f7f9;border:1px solid var(--line);border-radius:3px;padding:.8rem;
  overflow:auto;font-size:.82rem;line-height:1.5}
code{font-family:var(--mono);font-size:.9em}
blockquote{margin:1rem 0;padding:.4rem 0 .4rem 1rem;border-left:3px solid var(--accent);color:var(--ink)}

.prose h1{margin-top:0}
.prose table{font-size:.86rem}
.prose li{margin:.2rem 0}

.notice{background:var(--accent-bg);border:1px solid #cdd9f2;border-radius:3px;
  padding:.7rem .9rem;font-size:.9rem;margin:1rem 0}

.sitefooter{border-top:1px solid var(--line);margin-top:3rem}
.sitefooter .wrap{padding-top:1.6rem;padding-bottom:2.4rem;font-size:.85rem;color:var(--muted)}
.sitefooter nav{display:flex;flex-wrap:wrap;gap:.3rem 1rem;margin-bottom:.8rem}
.sitefooter nav a{color:var(--muted)}
.sitefooter .disclaimer{font-size:.82rem;line-height:1.55;max-width:42rem}

.admin label{display:block;margin:.7rem 0 .2rem;font-size:.85rem;font-weight:600}
.admin input,.admin textarea,.admin select{width:100%;max-width:34rem;font:inherit;font-size:.9rem;
  padding:.4rem .5rem;border:1px solid var(--line-strong);border-radius:2px}
.admin textarea{font-family:var(--mono);font-size:.82rem;min-height:7rem}
.admin .grid{display:grid;grid-template-columns:1fr 1fr;gap:1.6rem}
@media(max-width:44rem){.admin .grid{grid-template-columns:1fr}}
`;

function shell({ lang, title, path = '/', body, wide = false, extraHead = '' }) {
  lang = normalizeLang(lang);
  const L = (k) => t(lang, k);
  const w = wide ? ' wide' : '';
  const navItems = [
    ['/registry', L('nav_registry')],
    ['/spec', L('nav_spec')],
    ['/audit', L('nav_audit')],
    ['/about', L('nav_about')],
  ];
  const active = (p) => (path === p || (p !== '/' && path.startsWith(p)) ? ' aria-current="page"' : '');
  const navHtml = navItems
    .map(([p, lbl]) => `<a href="${href(lang, p)}"${active(p)}>${esc(lbl)}</a>`)
    .join('');
  const other = lang === 'ja' ? 'en' : 'ja';
  const langHtml = `<span class="lang"><a href="${href(other, path)}">${esc(t(other, 'lang_name'))}</a></span>`;

  const footNav = [
    ['/spec', L('foot_spec')],
    ['/registry', L('foot_registry')],
    ['/audit', L('foot_audit')],
    [SOURCE_REPO, L('foot_source')],
    ['/about', L('foot_maintainer')],
  ]
    .map(([p, lbl]) => `<a href="${href(lang, p)}">${esc(lbl)}</a>`)
    .join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>${extraHead}
</head><body>
<header class="siteheader"><div class="wrap${w}">
<span class="brand"><a class="mark" href="${href(lang, '/')}">TII</a>
<span class="sub">${esc(L('wordmark_sub'))}</span></span>
<nav>${navHtml}</nav>
${langHtml}
</div></header>
<main><div class="wrap${w}">${body}</div></main>
<footer class="sitefooter"><div class="wrap${w}">
<nav>${footNav}</nav>
<p>${esc(L('foot_maintained'))} ${esc(L('foot_independence'))}</p>
<p>${esc(L('foot_spec_version'))} ${SPEC_VERSION}</p>
<p class="disclaimer">${esc(L('disclaimer'))}</p>
</div></footer>
</body></html>`;
}

/* --------------------------------------------------------------- homepage --- */

function homePage({ lang, selfServiceEnabled = false }) {
  lang = normalizeLang(lang);
  const L = (k) => t(lang, k);
  const base = lang === 'ja' ? '/ja' : '';
  // Self-service issuance is a DYNAMIC-SERVER-ONLY capability (it writes to
  // the ledger) — never rendered on the static export, which has no live
  // endpoint to call. See src/server.js's /self-service/issue route: always
  // identifier_status "test", never production; rate-limited; off unless
  // TII_SELF_SERVICE_ENABLED=true. buildStaticSite() never passes
  // selfServiceEnabled, so it defaults to false there and this section is
  // simply absent — consistent with "no empty module blocks" (README.md).
  const selfServiceSection = selfServiceEnabled
    ? `
<section class="self-service">
<h2>${esc(L('self_service_heading'))}</h2>
<p class="muted small">${esc(L('self_service_intro'))}</p>
<form class="self-service-form">
<input name="note" maxlength="280" placeholder="${esc(L('self_service_note_placeholder'))}" aria-label="${esc(L('self_service_note_placeholder'))}">
<button type="submit">${esc(L('self_service_button'))}</button>
</form>
<p class="self-service-result" role="status" aria-live="polite"></p>
</section>`
    : '';
  const body = `
<section class="hero">
<div class="mark-lg">TII</div>
<div class="sub-lg">Transition-Ignition Identifier</div>
<div class="spec-status">${esc(L('spec_status'))} ${SPEC_VERSION}</div>
<p class="lead">${esc(L('home_desc'))}</p>
<form class="resolve" method="GET" action="${href(lang, '/resolve')}">
<input name="tii" placeholder="${esc(L('home_placeholder'))}" aria-label="${esc(L('home_search_label'))}"
  autocapitalize="off" autocorrect="off" spellcheck="false" required>
<button type="submit">${esc(L('home_resolve'))}</button>
</form>
</section>
${selfServiceSection}

<ul class="home-links">
<li><a href="${href(lang, '/registry')}">${esc(L('home_do_registry'))}</a></li>
<li><a href="${href(lang, '/spec')}">${esc(L('home_do_spec'))}</a></li>
<li><a href="${href(lang, '/audit')}">${esc(L('home_do_audit'))}</a></li>
</ul>

<p class="muted small">${esc(L('home_core_note'))}</p>

<script>
(function(){
${splitFragment.toString()}
var f=document.querySelector('form.resolve');if(!f)return;
f.addEventListener('submit',function(e){e.preventDefault();
var v=splitFragment(f.tii.value).base;if(!v){return;}
if(v.indexOf('tii:')!==0){v='tii:'+v.replace(/^tii[:_]?/,'');}
var slug=v.replace(/[^a-z0-9]+/g,'_');
window.location.href=${JSON.stringify(base)}+'/tii/'+slug;});})();
${selfServiceEnabled
  ? `
(function(){
var f=document.querySelector('form.self-service-form');if(!f)return;
var result=document.querySelector('.self-service-result');
var btn=f.querySelector('button');
var busyLabel=${JSON.stringify(L('self_service_button_busy'))};
var idleLabel=${JSON.stringify(L('self_service_button'))};
f.addEventListener('submit',function(e){
e.preventDefault();
btn.disabled=true;btn.textContent=busyLabel;result.textContent='';
fetch(${JSON.stringify(base)}+'/self-service/issue',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({note:f.note.value||undefined})
}).then(function(r){return r.json().then(function(b){return {ok:r.ok,status:r.status,body:b};});})
  .then(function(res){
    btn.disabled=false;btn.textContent=idleLabel;
    if(!res.ok){
      result.textContent=res.status===429?${JSON.stringify(L('self_service_error_rate_limited'))}:${JSON.stringify(L('self_service_error_generic'))};
      return;
    }
    result.textContent=${JSON.stringify(L('self_service_result_prefix'))}+res.body.tii;
    f.note.value='';
  }).catch(function(){
    btn.disabled=false;btn.textContent=idleLabel;
    result.textContent=${JSON.stringify(L('self_service_error_generic'))};
  });
});})();`
  : ''}
</script>
`;
  return shell({ lang, title: 'TII — Transition-Ignition Identifier', path: '/', body });
}

/* --------------------------------------------------------------- registry --- */

function registryPage({ lang, summaries = [] }) {
  lang = normalizeLang(lang);
  const L = (k) => t(lang, k);
  const rows = [...summaries]
    .sort((a, b) => String(b.last_recorded_at).localeCompare(String(a.last_recorded_at)))
    .map((s) => {
      const isTest = s.identifier_status === 'test';
      const ext = (s.external_ids || []).filter(Boolean);
      return `<tr>
<td><a class="mono" href="${href(lang, '/tii/' + s.slug)}">${esc(s.tii)}</a></td>
<td>${esc(recordStatusLabel(s.lifecycle_state, lang))}${
        isTest ? ` <span class="tag">${esc(L('test_identifier'))}</span>` : ''
      }${s.disputes ? ` <span class="chip warn">${esc(L('res_disputed'))}</span>` : ''}</td>
<td>${esc(humanizeEventType(s.last_event_type, lang))} <span class="muted small">${esc(formatDate(s.last_recorded_at))}</span></td>
<td class="small">${ext.length ? esc(ext.join(', ')) : '<span class="muted">—</span>'}</td>
<td class="muted small">${esc(formatDate(s.recorded_at))}</td>
</tr>`;
    })
    .join('');

  const body = `
<h1>${esc(L('registry_title'))}</h1>
<p class="muted">${esc(L('registry_intro'))}</p>
<p><input id="q" type="search" placeholder="${esc(L('registry_search'))}"
  style="width:100%;max-width:28rem;font:inherit;padding:.45rem .6rem;border:1px solid var(--line-strong);border-radius:2px"></p>
<div class="table-scroll"><table id="reg">
<thead><tr>
<th>${esc(L('col_tii'))}</th><th>${esc(L('col_status'))}</th>
<th>${esc(L('col_last_event'))}</th><th>${esc(L('col_external'))}</th>
<th>${esc(L('col_recorded_at'))}</th>
</tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="muted">${esc(L('registry_empty'))}</td></tr>`}</tbody>
</table></div>
<script>
(function(){var q=document.getElementById('q'),t=document.getElementById('reg');if(!q||!t)return;
q.addEventListener('input',function(){var v=q.value.toLowerCase();
t.tBodies[0].querySelectorAll('tr').forEach(function(r){
r.style.display=r.textContent.toLowerCase().indexOf(v)>-1?'':'none';});});})();
</script>
`;
  return shell({ lang, title: L('registry_title') + ' — TII', path: '/registry', body, wide: true });
}

/* ------------------------------------------------------- resolution page --- */

const SPECIALIZED_MODULES = new Set([
  'transition',
  'ignition',
  'address',
  'domain',
  'relation',
  'series',
  'external_identifier',
  'interpretation',
]);

function contentDl(content) {
  const entries = Object.entries(content || {}).filter(
    ([k]) => !['module', 'ref', 'act'].includes(k)
  );
  if (!entries.length) return '';
  return (
    '<dl class="kv">' +
    entries
      .map(
        ([k, v]) =>
          `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`
      )
      .join('') +
    '</dl>'
  );
}

/**
 * Render one record's content in the viewer's language. If an appended
 * localization event targets this record for `lang`, its translated fields are
 * shown (with a note) instead of the authored fields. This is display selection
 * only — see projection.displayContent — the ledger is never touched.
 */
function displayDl(p, lang, viewOrCurrent) {
  if (!viewOrCurrent) return '';
  const { content, localized, localization } = displayContent(p, viewOrCurrent, lang);
  const dl =
    contentDl(content) || `<p class="small mono">${esc(JSON.stringify(content))}</p>`;
  if (!localized) return dl;
  const label = lang === 'ja' ? '原記録から翻訳表示' : 'Shown translated from the authored record';
  return `${dl}<p class="muted small">${esc(label)} · ${esc(formatDate(localization.recorded_at))}</p>`;
}

function recordHistory(lang, bucket) {
  const L = (k) => t(lang, k);
  const rows = bucket.records
    .map(
      (r) => `<tr><td class="muted small">${esc(formatDate(r.recorded_at))}</td>
<td>${esc(r.act || humanizeEventType(r.event_type, lang))}</td>
<td class="small">${esc(r.recorder && r.recorder.id)}</td>
<td class="small mono">${esc(JSON.stringify(r.content))}</td></tr>`
    )
    .join('');
  const caption =
    lang === 'ja'
      ? 'この項目に記録された各イベントの原記録（翻訳前の正本内容）。'
      : 'Each recorded event for this item, as authored (canonical content, before any translation).';
  return `<details><summary>${esc(L('col_detail'))} (${bucket.records.length})</summary>
<p class="muted small">${esc(caption)}</p>
<div class="table-scroll"><table><thead><tr><th>${esc(L('col_time'))}</th><th>act</th><th>${esc(
    L('col_recorder')
  )}</th><th>content</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function moduleSection(p, lang, id, title, buckets, opts = {}) {
  const L = (k) => t(lang, k);
  const blocks = buckets
    .map((b) => {
      const flags = [];
      if (b.disputed) flags.push(`<span class="chip warn">${esc(L('res_disputed'))}</span>`);
      if (b.withdrawn) flags.push(`<span class="chip">${esc(L('res_withdrawn'))}</span>`);
      let note = '';
      if (opts.ignition) {
        note = `<p class="muted small">${esc(
          labels.ignitionDisplayLabels(b.records).join(' · ')
        )} — ${
          lang === 'ja'
            ? '（表示ラベルであり、存在論的状態集合ではない）'
            : '(display labels, not an ontological state set)'
        }</p>`;
      }
      const curHtml = b.current
        ? displayDl(p, lang, b.current)
        : `<p class="muted small">${esc(L('res_withdrawn'))}</p>`;
      return `<div class="record"><div class="ref">ref: ${esc(b.ref)} ${flags.join(' ')}</div>
${note}${curHtml}${recordHistory(lang, b)}</div>`;
    })
    .join('');
  return `<h2 id="${id}">${esc(title)}</h2>${blocks}`;
}

function resolutionPage({ lang, p, resolverBase = '', registryLabel = '' }) {
  lang = normalizeLang(lang);
  const L = (k) => t(lang, k);

  if (!p || !p.exists) {
    return shell({
      lang,
      title: L('res_not_found_title') + ' — TII',
      path: '/tii/',
      body: `<h1>${esc(L('res_not_found_title'))}</h1>
<p class="muted">${esc(L('res_not_found_body'))}</p>
${p && p.tii ? `<p class="idbox">${esc(p.tii)}</p>` : ''}`,
    });
  }

  const isTest = p.identifier_status === 'test';
  const lastEvent = p.events[p.events.length - 1];
  const interp = p.interpretation.length ? p.interpretation[p.interpretation.length - 1] : null;
  const recordModules = Object.entries(p.modules).filter(([m]) => !SPECIALIZED_MODULES.has(m));
  const hasEvidence = p.events.some((e) => (e.basis && e.basis.length) || e.content_verification);
  const addressBuckets = p.modules.address || [];
  const domainBuckets = p.modules.domain || [];
  const currentAddresses = addressBuckets.filter((b) => b.current);
  const anyCurrent = Object.values(p.modules).some((bs) => bs.some((b) => b.current));

  // section list
  const sections = [['overview', L('res_overview')]];
  if (recordModules.length) sections.push(['record', L('sec_record')]);
  sections.push(['events', L('sec_events')]);
  if (p.modules.transition) sections.push(['transitions', L('sec_transitions')]);
  if (p.modules.ignition) sections.push(['ignitions', L('sec_ignitions')]);
  if (addressBuckets.length || domainBuckets.length)
    sections.push(['address-domain', L('sec_address_domain')]);
  if (p.modules.relation || p.modules.series) sections.push(['relations', L('sec_relations')]);
  if (hasEvidence) sections.push(['evidence', L('sec_evidence')]);
  if (p.references.length) sections.push(['external', L('sec_external')]);
  sections.push(['audit', L('sec_audit')]);

  const toc = `<nav class="toc">${sections
    .map(([id, lbl]) => `<a href="#${id}">${esc(lbl)}</a>`)
    .join('')}</nav>`;

  // overview
  const extList = p.references.length
    ? p.references
        .map(
          (r) =>
            `${esc(r.scheme || r.source)}: <span class="mono">${esc(r.value || JSON.stringify(r.ref))}</span>${
              r.status ? ` <span class="muted small">(${esc(r.status)})</span>` : ''
            }`
        )
        .join('<br>')
    : `<span class="muted">${esc(L('res_none'))}</span>`;

  const addrList = currentAddresses.length
    ? currentAddresses
        .map((b) => {
          const v = b.current.content.value || '';
          const kind = b.current.content.kind ? ` <span class="muted small">(${esc(b.current.content.kind)})</span>` : '';
          const link = /^https?:\/\//.test(v)
            ? `<a class="mono" href="${esc(v)}" rel="noopener nofollow">${esc(v)}</a>`
            : `<span class="mono">${esc(v)}</span>`;
          return link + kind;
        })
        .join('<br>')
    : `<span class="muted">${esc(L('res_none'))}</span>`;

  const overview = `
<h2 id="overview">${esc(L('res_overview'))}</h2>
<dl class="kv">
<dt>${esc(L('res_current_interpretation'))}</dt>
<dd>${
    interp
      ? esc(
          displayContent(p, interp, lang).content.description ||
            JSON.stringify(displayContent(p, interp, lang).content)
        )
      : `<span class="muted">${esc(L('res_no_interpretation'))}</span>`
  }</dd>
<dt>${esc(L('res_last_event'))}</dt>
<dd>${esc(humanizeEventType(lastEvent.event_type, lang))} <span class="muted small">${esc(formatDate(lastEvent.recorded_at))}</span></dd>
<dt>${esc(L('res_external_ids'))}</dt>
<dd>${extList}</dd>
<dt>${esc(L('res_addresses'))}</dt>
<dd>${addrList}${currentAddresses.length ? `<br><span class="muted small">${esc(L('res_addresses_note'))}</span>` : ''}</dd>
${resolverBase ? `<dt>${esc(L('res_resolvable_at'))}</dt><dd class="mono small">${esc(resolverBase.replace(/\/$/, '') + '/tii/' + p.tii)}</dd>` : ''}
</dl>
${!anyCurrent && !interp ? `<p class="notice">${esc(L('res_no_current_state'))}</p>` : ''}
`;

  // events
  const eventsRows = p.events
    .map(
      (e) => `<tr>
<td class="muted small">${e.seq}</td>
<td class="muted small">${esc(formatDate(e.recorded_at))}</td>
<td>${esc(humanizeEventType(e.event_type, lang))}</td>
<td class="small">${esc(e.recorder && e.recorder.id)}</td>
<td class="small mono">${esc(e.supersedes ? String(e.supersedes).slice(0, 10) + '…' : '')}</td>
<td class="small mono" title="${esc(e.hash)}">${esc(String(e.hash).slice(0, 10))}…</td>
</tr>`
    )
    .join('');
  const eventsSection = `
<h2 id="events">${esc(L('sec_events'))}</h2>
<p class="muted small">${esc(L('res_events_intro'))}</p>
<div class="table-scroll"><table><thead><tr>
<th>${esc(L('col_seq'))}</th><th>${esc(L('col_time'))}</th><th>${esc(L('col_type'))}</th>
<th>${esc(L('col_recorder'))}</th><th>${esc(L('col_supersedes'))}</th><th>${esc(L('col_hash'))}</th>
</tr></thead><tbody>${eventsRows}</tbody></table></div>
`;

  // record modules
  const recordSection = recordModules.length
    ? `<h2 id="record">${esc(L('sec_record'))}</h2>` +
      recordModules
        .map(([m, buckets]) =>
          buckets
            .map(
              (b) =>
                `<div class="record"><div class="ref">${esc(m)} · ref: ${esc(b.ref)}</div>${
                  displayDl(p, lang, b.current || b.records[b.records.length - 1])
                }${recordHistory(lang, b)}</div>`
            )
            .join('')
        )
        .join('')
    : '';

  const transitionsSection = p.modules.transition
    ? moduleSection(p, lang, 'transitions', L('sec_transitions'), p.modules.transition)
    : '';
  const ignitionsSection = p.modules.ignition
    ? moduleSection(p, lang, 'ignitions', L('sec_ignitions'), p.modules.ignition, { ignition: true })
    : '';

  const addressDomainSection =
    addressBuckets.length || domainBuckets.length
      ? `<h2 id="address-domain">${esc(L('sec_address_domain'))}</h2>` +
        (addressBuckets.length
          ? `<h3>${lang === 'ja' ? 'アドレス' : 'Address'}</h3>` +
            addressBuckets
              .map(
                (b) =>
                  `<div class="record"><div class="ref">ref: ${esc(b.ref)}</div>${
                    displayDl(p, lang, b.current || b.records[b.records.length - 1])
                  }${recordHistory(lang, b)}</div>`
              )
              .join('')
          : '') +
        (domainBuckets.length
          ? `<h3>${lang === 'ja' ? 'ドメイン' : 'Domain'}</h3>` +
            domainBuckets
              .map(
                (b) =>
                  `<div class="record"><div class="ref">ref: ${esc(b.ref)}</div>${
                    displayDl(p, lang, b.current || b.records[b.records.length - 1])
                  }${recordHistory(lang, b)}</div>`
              )
              .join('')
          : '')
      : '';

  const relationsSection =
    p.modules.relation || p.modules.series
      ? `<h2 id="relations">${esc(L('sec_relations'))}</h2>` +
        (p.modules.relation
          ? p.modules.relation
              .map(
                (b) =>
                  `<div class="record"><div class="ref">relation · ref: ${esc(b.ref)}</div>${
                    displayDl(p, lang, b.current || b.records[b.records.length - 1])
                  }${recordHistory(lang, b)}</div>`
              )
              .join('')
          : '') +
        (p.modules.series
          ? p.modules.series
              .map(
                (b) =>
                  `<div class="record"><div class="ref">series · ref: ${esc(b.ref)}</div>${
                    displayDl(p, lang, b.current || b.records[b.records.length - 1])
                  }${recordHistory(lang, b)}</div>`
              )
              .join('')
          : '')
      : '';

  const evidenceSection = hasEvidence
    ? `<h2 id="evidence">${esc(L('sec_evidence'))}</h2>
<div class="table-scroll"><table><thead><tr><th>${esc(L('col_time'))}</th><th>${esc(
        L('col_type')
      )}</th><th>basis</th><th>content_verification</th></tr></thead><tbody>${p.events
        .filter((e) => (e.basis && e.basis.length) || e.content_verification)
        .map(
          (e) => `<tr><td class="muted small">${esc(formatDate(e.recorded_at))}</td>
<td>${esc(humanizeEventType(e.event_type, lang))}</td>
<td class="small mono">${esc((e.basis || []).join(', '))}</td>
<td class="small mono">${esc(e.content_verification ? `${e.content_verification.algo}:${e.content_verification.value}` : '')}</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : '';

  const externalSection = p.references.length
    ? `<h2 id="external">${esc(L('sec_external'))}</h2>
<div class="table-scroll"><table><thead><tr><th>scheme</th><th>value</th><th>status</th><th>${esc(
        L('col_time')
      )}</th></tr></thead><tbody>${p.references
        .map(
          (r) => `<tr><td>${esc(r.scheme || r.source)}</td>
<td class="mono small">${esc(r.value || JSON.stringify(r.ref))}</td>
<td class="small">${esc(r.status || '')}</td>
<td class="muted small">${esc(formatDate(r.recorded_at))}</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : '';

  const auditSection = `
<h2 id="audit">${esc(L('sec_audit'))}</h2>
<dl class="kv">
<dt>${esc(L('audit_recorded_events'))}</dt><dd>${p.event_count}</dd>
<dt>${esc(L('audit_head_hash'))}</dt><dd class="mono small">${esc(lastEvent.hash)}</dd>
</dl>
<p class="small"><a href="${href(lang, '/audit')}">${esc(L('nav_audit'))} →</a></p>
`;

  const machine = `<p class="small"><a href="/tii/${tiiToFileSlug(p.tii)}.json">${esc(L('res_structured'))}</a></p>`;

  // Provenance (Phase 11, public self-service deployments only): rendered
  // only when the operator has configured a registry label, so an ordinary
  // deployment that never sets TII_REGISTRY_LABEL renders exactly as before.
  // This never touches the `tii:` URI syntax or the token itself — it is
  // purely a page-level statement plus a link to this registry's own
  // read-only verification surface, sourced from configuration
  // (resolverBase), never hardcoded.
  const registryProvenance =
    isTest && registryLabel
      ? `<p class="small muted">${esc(L('registry_provenance_label'))} <strong>${esc(registryLabel)}</strong><br>
<a href="${esc((resolverBase || '') + '/verify')}">${esc(L('registry_provenance_link'))}</a></p>`
      : '';

  const body = `
<h1>TII</h1>
<div class="idbox">${esc(p.tii)}</div>
<p>${isTest ? `<span class="tag">${esc(L('test_identifier'))}</span> ` : ''}
<span class="chip">${esc(recordStatusLabel(p.lifecycle_state, lang))}</span>
${p.disputes.length ? `<span class="chip warn">${esc(L('res_disputed'))} ${p.disputes.length}</span>` : ''}</p>
${registryProvenance}
${toc}
${overview}
${recordSection}
${eventsSection}
${transitionsSection}
${ignitionsSection}
${addressDomainSection}
${relationsSection}
${evidenceSection}
${externalSection}
${auditSection}
${machine}
`;
  return shell({ lang, title: p.tii + ' — TII', path: '/tii/' + tiiToFileSlug(p.tii), body });
}

/* ---------------------------------------------------------- spec / about --- */

function docPage({ lang, title, path, markdown }) {
  return shell({
    lang: normalizeLang(lang),
    title: title + ' — TII',
    path,
    body: `<div class="prose">${renderMarkdown(markdown)}</div>`,
  });
}

/* --------------------------------------------------------------- audit --- */

/**
 * TWO DISTINCT CLAIMS — never collapse into one green "Verified" badge
 * (production-hardening Phase 1, spec/checkpoint-operation.md §1):
 *   A. `verification` (Ledger.verify())      — internal chain integrity.
 *   B. `checkpoint` (checkpoint-store status) — an externally-held signed
 *      attestation. VERIFIED / UNVERIFIED / MISSING / INVALID — never
 *      reported as simply "verified" the way (A) is.
 */
function auditPage({ lang, verification, generatedAt, exportBase = '/export/ledger', checkpoint }) {
  lang = normalizeLang(lang);
  const L = (k) => t(lang, k);
  const ok = verification && verification.ok;

  const chip = (status) =>
    `<span class="chip${status === 'VERIFIED' ? '' : status === 'INVALID' ? ' warn' : ''}">${esc(
      L('checkpoint_status_' + status) || status
    )}</span>`;

  const checkpointSection = (() => {
    if (!checkpoint) {
      return `<p class="muted">${esc(L('checkpoint_status_MISSING'))}</p>`;
    }
    const rows = [];
    rows.push(`<dt>${esc(L('audit_checkpoint_title'))}</dt><dd>${chip(checkpoint.status)}</dd>`);
    if (checkpoint.checkpoint) {
      rows.push(`<dt>${esc(L('audit_checkpoint_head'))}</dt><dd class="mono small">${esc(checkpoint.checkpoint.ledger_head_hash)}</dd>`);
      rows.push(`<dt>${esc(L('audit_checkpoint_created'))}</dt><dd>${esc(checkpoint.checkpoint.created_at)}</dd>`);
    }
    if (checkpoint.key_id) rows.push(`<dt>${esc(L('audit_checkpoint_key'))}</dt><dd class="mono small">${esc(checkpoint.key_id)}</dd>`);
    if (checkpoint.status === 'VERIFIED') {
      rows.push(`<dt>${esc(L('audit_checkpoint_matches'))}</dt><dd>${checkpoint.matches_current_head ? '✓' : '✗ — ' + esc(checkpoint.note || '')}</dd>`);
    }
    if (checkpoint.reason) rows.push(`<dt>${esc(L('audit_checkpoint_reason'))}</dt><dd class="small">${esc(checkpoint.reason)}</dd>`);
    return `<dl class="kv">${rows.join('')}</dl>`;
  })();

  const body = `
<h1>${esc(L('audit_title'))}</h1>
<p class="muted">${esc(L('audit_intro'))}</p>
<p class="notice">${esc(L('audit_two_claims_note'))}</p>

<h2>${esc(L('audit_integrity'))}</h2>
<dl class="kv">
<dt>${esc(L('audit_integrity'))}</dt>
<dd>${ok ? `<span class="chip">${esc(L('audit_ok'))}</span>` : `<span class="chip warn">${esc(L('audit_bad'))}</span>`}</dd>
<dt>${esc(L('audit_last_verified'))}</dt><dd>${esc(generatedAt || new Date().toISOString())}</dd>
<dt>${esc(L('audit_recorded_events'))}</dt><dd>${verification ? verification.event_count : '—'}</dd>
<dt>${esc(L('audit_head_hash'))}</dt><dd class="mono small">${esc(verification ? verification.head_hash : '')}</dd>
</dl>
${ok ? '' : `<pre>${esc(JSON.stringify(verification && verification.problems, null, 2))}</pre>`}
<h3>${esc(L('audit_method'))}</h3>
<p class="small">${esc(L('audit_method_body'))}</p>

<h2 id="checkpoint">${esc(L('audit_checkpoint_title'))}</h2>
<p class="muted small">${esc(L('audit_checkpoint_intro'))}</p>
${checkpointSection}

<h2>${esc(L('audit_exports'))}</h2>
<ul>
<li><a href="${exportBase}.jsonl">${esc(L('audit_export_jsonl'))}</a></li>
<li><a href="${exportBase}.json">${esc(L('audit_export_json'))}</a></li>
<li><a href="${exportBase}.csv">${esc(L('audit_export_csv'))}</a></li>
</ul>
`;
  return shell({ lang, title: L('audit_title') + ' — TII', path: '/audit', body });
}

/* --------------------------------------------------------------- 404 --- */

function notFoundPage({ lang }) {
  lang = normalizeLang(lang);
  return shell({
    lang,
    title: 'Not found — TII',
    path: '/',
    body: `<h1>Not found</h1><p class="muted">The requested page does not exist.</p>
<p><a href="${href(lang, '/')}">TII</a> · <a href="${href(lang, '/registry')}">${esc(
      t(lang, 'nav_registry')
    )}</a></p>`,
  });
}

/* --------------------------------------------------------------- admin --- */

/**
 * NO ADMIN TOKEN = ADMIN DISABLED (production-hardening Phase 1, P0-B). When
 * `enabled` is false this renders NO forms, NO TII listing, and NO quick-fill
 * catalogue — only the reason and how to enable it. There is no "open by
 * default" fallback.
 */
function adminDisabledPage() {
  const body = `
<h1>Admin</h1>
<div class="notice">
<strong>Admin is disabled.</strong> No <code>TII_ADMIN_TOKEN</code> is configured.
No admin token means no admin capability — not open access. Set
<code>TII_ADMIN_TOKEN</code> to a strong random value in the server environment
to enable issuance, event append, and file hashing. The token is an
operational control, not a TII identity property: it is never printed,
logged, included in exports, or written into any event.
</div>
<p class="small"><a href="/status">Operational status</a> · <a href="/audit">Audit</a></p>
`;
  return shell({ lang: 'en', title: 'Admin (disabled) — TII', path: '/admin', body, wide: true });
}

function adminPage({ tiis = [], tokenRequired, hashDirConfigured }) {
  if (!tokenRequired) return adminDisabledPage();
  const tiiOptions = tiis.map((x) => `<option value="${esc(x)}">`).join('');
  const eventTypeOptions = labels.KNOWN_EVENT_TYPES.map((x) => `<option value="${esc(x)}">`).join('');
  const quick = [
    ['Append evidence reference', 'evidence.referenced', { module: 'note', ref: 'e-1', description: '…' }],
    ['Add external identifier', 'external.ref.added', { module: 'external_identifier', ref: 'ext-1', act: 'introduce', scheme: 'doi', value: '10.xxxx/xxxx' }],
    ['Add address', 'address.described', { module: 'address', ref: 'addr-1', act: 'introduce', kind: 'public-location', value: 'https://…' }],
    ['Add domain', 'domain.described', { module: 'domain', ref: 'dom-1', act: 'introduce', label: '…', scope: '…' }],
    ['Add ignition description', 'ignition.described', { module: 'ignition', ref: 'ig-1', act: 'introduce', what: '…', under_conditions: '…' }],
    ['Suspend ignition', 'ignition.suspended', { module: 'ignition', ref: 'ig-1', act: 'stop', reason: '…' }],
    ['Withdraw ignition classification', 'ignition.withdrawn', { module: 'ignition', ref: 'ig-1', act: 'withdraw', description: 'classifying this as ignition was withdrawn' }],
    ['Add transition description', 'transition.described', { module: 'transition', ref: 'tr-1', act: 'introduce', relation_kind: 'precedes', from_ref: '…', to_ref: '…' }],
    ['Withdraw transition classification', 'transition.withdrawn', { module: 'transition', ref: 'tr-1', act: 'withdraw', description: '…' }],
    ['Add relation', 'relation.asserted', { module: 'relation', ref: 'rel-1', act: 'introduce', relation_type: 'stores', subject: '…', object: 'this' }],
    ['Series judgement', 'series.judged', { module: 'series', ref: 'ser-1', act: 'introduce', judgement: 'same-series', members: ['tii:…'], reason: '…' }],
    ['Record contestation', 'dispute.raised', { about_event: 'evt_…', reason: '…' }],
    ['Record correction', 'record.corrected', { note: 'metadata correction', corrected_fields: {} }],
    ['Revise interpretation', 'interpretation.revised', { module: 'interpretation', ref: 'what', description: '…' }],
    ['Record withdrawal', 'tii.retracted', { reason: 'issued in error; string and history retained' }],
    ['Transfer authority', 'authority.transferred', { from: '…', to: '…', reason: '…' }],
  ];
  const quickRows = quick
    .map(
      ([label, type], i) =>
        `<tr><td>${esc(label)}</td><td class="mono small">${esc(type)}</td><td><button type="button" class="btn secondary" onclick="fill(${i})">use</button></td></tr>`
    )
    .join('');

  const body = `
<h1>Admin</h1>
<div class="notice">
<strong>PUBLIC RECORD.</strong> Information recorded here may appear in public
exports, APIs, static mirrors, and archival copies. Do not enter secrets,
credentials, private personal data, or restricted evidence. TII 1.0 is a
<strong>public-only</strong> registry — see <a href="/spec">Specification</a>
and <code>spec/public-only-1.0.md</code>. This is a scope limit, not a privacy
guarantee: nothing entered here can later be made confidential.
</div>
<p class="muted small">Writes require the <code>X-TII-Token</code> header or a
<code>token</code> field (never logged, never stored in an event, never
exported). An issued TII is not deleted; erroneous issuance is handled as a
withdrawal / suspension / non-public event. Optional modules are never treated
as mandatory ontological fields.</p>
<div class="grid">
<div>
<h2>Issue TII</h2>
<form method="POST" action="/admin/issue">
<label>Recorder</label><input name="recorder" required placeholder="admin">
<label>Token</label><input name="token" type="password" autocomplete="off">
<label>Idempotency key (optional)</label><input name="idempotency_key">
<label>Tracking-started note</label><input name="note">
<p><button class="btn" type="submit">Issue</button></p>
</form>
<h2>Hash a file (SHA-256)</h2>
${
  hashDirConfigured
    ? `<form method="POST" action="/admin/hash-file">
<label>Path, relative to the configured safe directory</label><input name="path" required placeholder="evidence/file.pdf">
<label>Token</label><input name="token" type="password" autocomplete="off">
<p><button class="btn" type="submit">Compute</button></p>
</form>
<p class="muted small">Restricted to <code>TII_ADMIN_HASH_DIR</code>; paths that escape it are rejected. Not an arbitrary server-file reader.</p>`
    : `<p class="muted small">Disabled — <code>TII_ADMIN_HASH_DIR</code> is not configured. Set it to a directory to enable hashing files within it (never an arbitrary server path).</p>`
}
</div>
<div>
<h2>Append event</h2>
<form method="POST" action="/admin/event" id="ef">
<label>Target TII</label><input name="tii" list="tiis" required placeholder="tii:…">
<datalist id="tiis">${tiiOptions}</datalist>
<label>event_type (free string)</label><input name="event_type" list="etypes" required value="record.added">
<datalist id="etypes">${eventTypeOptions}</datalist>
<label>Recorder</label><input name="recorder" required placeholder="admin">
<label>Token</label><input name="token" type="password" autocomplete="off">
<label>Idempotency key (optional — a retried request with the same key returns the original event instead of duplicating it)</label><input name="idempotency_key">
<label>content (JSON)</label><textarea name="content">{
  "module": "note",
  "description": "…"
}</textarea>
<label>basis (JSON array)</label><textarea name="basis" style="min-height:3rem">[]</textarea>
<label>external_refs (JSON array)</label><textarea name="external_refs" style="min-height:3rem">[]</textarea>
<label>content_verification (JSON, optional)</label><input name="content_verification" placeholder='{"algo":"sha256","value":"…"}'>
<label>supersedes (event_id, optional)</label><input name="supersedes">
<p><button class="btn" type="submit">Append</button></p>
</form>
</div>
</div>

<h2>Quick fill</h2>
<div class="table-scroll"><table><thead><tr><th>Action</th><th>event_type</th><th></th></tr></thead><tbody>${quickRows}</tbody></table></div>

<h2>Export, verify &amp; operational status</h2>
<ul>
<li><a href="/export/ledger.jsonl">Full ledger (JSON Lines)</a></li>
<li><a href="/export/ledger.json">Full ledger (JSON)</a></li>
<li><a href="/export/ledger.csv">Full ledger (CSV)</a></li>
<li><a href="/verify">Ledger chain integrity only (JSON)</a></li>
<li><a href="/checkpoint/verify">Signed checkpoint status (JSON)</a> · <a href="/checkpoint/list">list</a></li>
<li><a href="/status">All operational states (JSON)</a></li>
<li><a href="/audit">Audit page</a></li>
</ul>

<script>
var QUICK=${JSON.stringify(quick.map(([l, ty, c]) => ({ ty, c })))};
function fill(i){var q=QUICK[i];document.querySelector('#ef [name=event_type]').value=q.ty;
document.querySelector('#ef [name=content]').value=JSON.stringify(q.c,null,2);
document.querySelector('#ef').scrollIntoView({behavior:'smooth'});}
</script>
`;
  return shell({ lang: 'en', title: 'Admin — TII', path: '/admin', body, wide: true });
}

/* --------------------------------------------------------------- misc --- */

function messagePage({ lang = 'en', title, html }) {
  return shell({ lang: normalizeLang(lang), title: title + ' — TII', path: '/admin', body: `<h1>${esc(title)}</h1>${html}` });
}

module.exports = {
  esc,
  href,
  shell,
  homePage,
  registryPage,
  resolutionPage,
  docPage,
  auditPage,
  adminPage,
  notFoundPage,
  messagePage,
};
