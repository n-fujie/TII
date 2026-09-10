'use strict';

const fs = require('node:fs');
const path = require('node:path');

const labels = require('./labels');
const { tiiToFileSlug } = require('./id');

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(v) {
  return esc(JSON.stringify(v, null, 2));
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;
  background:#fbfbfa;color:#1c1c1c}
@media(prefers-color-scheme:dark){body{background:#161616;color:#e7e7e7}}
a{color:#2563eb}@media(prefers-color-scheme:dark){a{color:#7ab0ff}}
header{border-bottom:1px solid #ddd;padding:14px 20px;display:flex;gap:18px;align-items:baseline}
@media(prefers-color-scheme:dark){header{border-color:#333}}
header .brand{font-weight:700}
main{max-width:960px;margin:0 auto;padding:22px 20px 80px}
h1{font-size:20px;margin:.2em 0 .1em}h2{font-size:16px;margin:1.6em 0 .5em;border-bottom:1px solid #e3e3e3;padding-bottom:3px}
@media(prefers-color-scheme:dark){h2{border-color:#333}}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tii{font-family:ui-monospace,Menlo,monospace;font-size:17px;font-weight:600;word-break:break-all}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;border:1px solid #bbb;margin-right:6px}
.pill.warn{background:#fff4e5;border-color:#e0a860}.pill.test{background:#eef;border-color:#88a}
@media(prefers-color-scheme:dark){.pill{border-color:#555}.pill.warn{background:#3a2c14}.pill.test{background:#22243a}}
table{border-collapse:collapse;width:100%;font-size:13px;margin:.4em 0}
td,th{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}
@media(prefers-color-scheme:dark){td,th{border-color:#383838}}
pre{background:#f0f0ef;padding:10px;border-radius:6px;overflow:auto;font-size:12px}
@media(prefers-color-scheme:dark){pre{background:#0e0e0e}}
form{margin:.6em 0}input,select,textarea{font:inherit;padding:6px 8px;border:1px solid #bbb;border-radius:5px;
  background:transparent;color:inherit;width:100%;max-width:520px}
textarea{min-height:120px;font-family:ui-monospace,Menlo,monospace;font-size:12px}
button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid #888;background:#efefef;cursor:pointer}
@media(prefers-color-scheme:dark){button{background:#2a2a2a;color:#eee}}
label{display:block;margin:.5em 0 .15em;font-size:13px;font-weight:600}
.muted{color:#777;font-size:12px}
.module{border:1px solid #e0e0e0;border-radius:8px;padding:10px 12px;margin:.5em 0}
@media(prefers-color-scheme:dark){.module{border-color:#363636}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
details{margin:.3em 0}summary{cursor:pointer;font-weight:600}
nav.crumbs{font-size:13px;margin-bottom:10px}
`;

function page(title, body, opts = {}) {
  // Static export (Vercel etc.) is a READ-ONLY mirror: no admin, and "監査" points
  // at the catalog JSON that carries the verification result. cleanUrls maps
  // "/spec" -> spec.html and "/" -> index.html.
  const nav = opts.static
    ? `<a href="/spec">仕様</a> · <a href="/catalog.json">監査</a> · <a href="/ledger.jsonl">台帳</a>`
    : `<a href="/spec">仕様</a> · <a href="/admin">管理</a> · <a href="/verify">監査</a>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><span class="brand"><a href="/">TII</a></span>
<span class="muted">Transition-Ignition Identifier — 試験版 / PROVISIONAL${opts.static ? '（読み取り専用ミラー）' : ''}</span>
<span style="margin-left:auto">${nav}</span>
</header><main>${body}</main></body></html>`;
}

/* ------------------------------------------------------------------ index --- */

function renderIndexPage({ summaries = [], recent = [], verification, static: isStatic }) {
  const base = isStatic ? '' : '';
  const rows = summaries
    .sort((a, b) => String(b.last_recorded_at).localeCompare(String(a.last_recorded_at)))
    .map(
      (s) => `<tr>
<td><a href="/tii/${isStatic ? tiiToFileSlug(s.tii) : encodeURIComponent(s.tii)}" class="mono">${esc(s.tii)}</a></td>
<td>${esc(s.identifier_status)}</td>
<td>${esc(s.lifecycle_state)}</td>
<td>${s.event_count}</td>
<td>${s.disputes ? '⚠ ' + s.disputes : '—'}</td>
<td class="muted">${esc(s.last_recorded_at || '')}</td></tr>`
    )
    .join('');

  const recentRows = recent
    .map(
      (e) => `<tr><td class="muted">${esc(e.recorded_at)}</td>
<td><a href="${base}/tii/${encodeURIComponent(e.tii)}" class="mono">${esc(e.tii)}</a></td>
<td>${esc(e.event_type)}</td><td>${esc((e.content && e.content.module) || '')}</td></tr>`
    )
    .join('');

  const body = `
<h1>TII — 遷移発火識別子</h1>
<p class="muted">ある参照点について、そこで採用された記述・判定・発火・遷移・アドレス・ドメイン・境界・関係・系列等が、
いつ・どの条件で導入され、どのように変更・停止・異議・再記述されたかを、過去を消去せず追跡する識別・監査インフラ。</p>

${isStatic ? '' : `
<h2>TII検索</h2>
<form method="GET" action="/resolve"><label for="q">TII</label>
<input id="q" name="tii" placeholder="tii:xxxxxxxxxxxx" required>
<button type="submit">開く</button></form>

<h2>TII発行</h2>
<form method="POST" action="/admin/issue">
<label for="rec">記録主体</label><input id="rec" name="recorder" placeholder="admin" required>
<label for="note">追跡開始メモ（任意）</label><input id="note" name="note" placeholder="この参照点から追跡を開始した理由">
<button type="submit">発行（試験用識別子）</button>
<div class="muted">発行が意味するのは「この参照点から追跡を開始した」ことだけ。</div></form>
`}

<h2>記録のあるTII</h2>
<table><tr><th>TII</th><th>識別子状態</th><th>ライフサイクル</th><th>件数</th><th>異議</th><th>最終記録</th></tr>${rows || '<tr><td colspan="6" class="muted">なし</td></tr>'}</table>

${recent.length ? `<h2>最近の記録</h2><table><tr><th>時刻</th><th>TII</th><th>種別</th><th>モジュール</th></tr>${recentRows}</table>` : ''}

<h2>監査</h2>
<p>${verification && verification.ok ? '✅ ハッシュ連鎖 整合' : '❌ ' + esc(JSON.stringify(verification && verification.problems))}
 — イベント ${verification ? verification.event_count : '?'} 件</p>

<h2>仕様</h2>
<p><a href="${base}/spec">TII公開仕様書（試験版）</a> — TIIが保証しないこと／しないことの一覧を含む。</p>
`;
  return page('TII', body, { static: isStatic });
}

/* ------------------------------------------------------- resolution page --- */

function moduleBlock(mod, buckets) {
  const jaName = labels.MODULE_LABELS_JA[mod] || mod;
  const parts = buckets.map((b) => {
    const cur = b.current;
    const flags = [];
    if (b.disputed) flags.push('<span class="pill warn">異議あり</span>');
    if (b.withdrawn) flags.push('<span class="pill">撤回/停止</span>');
    let extra = '';
    if (mod === 'ignition') {
      extra = `<div class="muted">表示ラベル: ${labels
        .ignitionDisplayLabels(b.records)
        .map(esc)
        .join(' / ')}（基礎データモデルの存在論的状態集合ではない）</div>`;
    }
    const history = b.records
      .map(
        (r) =>
          `<tr><td class="muted">${esc(r.recorded_at)}</td><td>${esc(r.act || r.event_type)}</td>
<td>${esc(r.recorder && r.recorder.id)}</td><td><code>${esc(JSON.stringify(r.content))}</code></td></tr>`
      )
      .join('');
    return `<div class="module"><strong>${esc(jaName)}</strong> · <span class="mono">ref=${esc(b.ref)}</span> ${flags.join(' ')}
${extra}
<div>現在の読み: ${cur ? `<code>${esc(JSON.stringify(cur.content))}</code>` : '<span class="muted">なし（撤回/停止、または未確定）</span>'}</div>
<details><summary>この項目の記録履歴（${b.records.length}）</summary>
<table><tr><th>時刻</th><th>作動</th><th>記録主体</th><th>内容</th></tr>${history}</table></details></div>`;
  });
  return `<h2>${esc(jaName)}（${mod}）</h2>${parts.join('')}`;
}

function renderResolutionPage(p, opts = {}) {
  const base = opts.static ? '' : '';
  if (!p || !p.exists) {
    return page('TII 未発行', `<h1>未発行または不明なTII</h1><p class="muted">${esc((p && p.tii) || '')}</p>`, opts);
  }
  const modulesHtml = Object.entries(p.modules)
    .map(([m, buckets]) => moduleBlock(m, buckets))
    .join('');

  const primary = summarizeCurrent(p);

  const body = `
<nav class="crumbs"><a href="${base}/">TII</a> / 解決ページ</nav>
<h1 class="tii">${esc(p.tii)}</h1>
<p>
<span class="pill test">識別子状態: ${esc(p.identifier_status)}</span>
<span class="pill">ライフサイクル: ${esc(p.lifecycle_state)}</span>
${p.disputes.length ? `<span class="pill warn">異議 ${p.disputes.length}</span>` : ''}
</p>
<p class="muted">最終記録: ${esc(p.last_recorded_at || '')} · イベント ${p.event_count} 件 · head hash <code>${esc((p.events.at(-1) || {}).hash || '')}</code></p>

<h2>主要な現在記録</h2>
${primary || '<p class="muted">現在有効と解釈される記録はまだない（固定された「現在状態」は常には存在しない）。</p>'}

${p.interpretation.length ? `<h2>解釈の改訂（何を追跡していると解釈されているか）</h2><ul>${p.interpretation
    .map((i) => `<li class="muted">${esc(i.recorded_at)} — ${esc(JSON.stringify(i.content))}</li>`)
    .join('')}</ul>` : ''}

${p.references.length ? `<h2>外部参照</h2><table><tr><th>種類</th><th>値</th><th>状態</th><th>時刻</th></tr>${p.references
    .map(
      (r) => `<tr><td>${esc(r.scheme || r.source)}</td><td class="mono">${esc(
        r.value || JSON.stringify(r.ref)
      )}</td><td>${esc(r.status || '')}</td><td class="muted">${esc(r.recorded_at)}</td></tr>`
    )
    .join('')}</table>` : ''}

${p.disputes.length ? `<h2>異議</h2><ul>${p.disputes
    .map((d) => `<li>${esc(d.recorded_at)} — ${esc(d.recorder && d.recorder.id)}: ${esc(JSON.stringify(d.content))}</li>`)
    .join('')}</ul>` : ''}

${p.corrections.length ? `<h2>訂正（旧記録は保持）</h2><ul>${p.corrections
    .map((c) => `<li>${esc(c.recorded_at)} — supersedes <code>${esc(c.supersedes)}</code>: ${esc(JSON.stringify(c.content))}</li>`)
    .join('')}</ul>` : ''}

${modulesHtml || ''}

<h2>監査履歴（全イベント・追記型・消去なし）</h2>
<table><tr><th>seq</th><th>時刻</th><th>種別</th><th>記録主体</th><th>supersedes</th><th>hash</th></tr>
${p.events
  .map(
    (e) => `<tr><td>${e.seq}</td><td class="muted">${esc(e.recorded_at)}</td><td>${esc(e.event_type)}</td>
<td>${esc(e.recorder && e.recorder.id)}</td><td class="mono">${esc(e.supersedes || '')}</td>
<td class="mono" title="${esc(e.hash)}">${esc(String(e.hash).slice(0, 12))}…</td></tr>`
  )
  .join('')}</table>

<h2>機械取得</h2>
<p><a href="${base}/tii/${opts.static ? tiiToFileSlug(p.tii) + '.json' : encodeURIComponent(p.tii) + '/data'}">構造化データ (JSON)</a>
${opts.static ? '' : ` · <a href="/api/tii/${encodeURIComponent(p.tii)}/events">events</a> · <a href="/api/tii/${encodeURIComponent(p.tii)}/history">history</a>`}</p>

<hr><p class="muted">${esc(p.disclaimer)}</p>
`;
  return page('TII ' + p.tii, body, opts);
}

function summarizeCurrent(p) {
  const items = [];
  for (const [m, buckets] of Object.entries(p.modules)) {
    for (const b of buckets) {
      if (b.current) {
        items.push(
          `<li><strong>${esc(labels.MODULE_LABELS_JA[m] || m)}</strong> (ref ${esc(b.ref)}): <code>${esc(
            JSON.stringify(b.current.content)
          )}</code>${b.disputed ? ' <span class="pill warn">異議</span>' : ''}</li>`
        );
      }
    }
  }
  return items.length ? `<ul>${items.join('')}</ul>` : '';
}

/* -------------------------------------------------------------- spec page --- */

function renderSpecPage(opts = {}) {
  let md = '';
  try {
    md = fs.readFileSync(path.join(__dirname, '..', 'SPEC.md'), 'utf8');
  } catch {
    md = 'SPEC.md not found';
  }
  return page('TII 仕様', `<h1>TII 公開仕様書</h1><pre>${esc(md)}</pre>`, opts);
}

/* ------------------------------------------------------------- admin page --- */

function renderAdminPage({ tiis = [], token_required }) {
  const tiiOptions = tiis.map((t) => `<option value="${esc(t)}">`).join('');
  const eventTypeOptions = labels.KNOWN_EVENT_TYPES.map((t) => `<option value="${esc(t)}">`).join('');

  const quick = [
    ['ファイル登録 / 内容ハッシュ', 'content.hash.recorded', { module: 'content', algo: 'sha256', value: '<sha256>', filename: '' }],
    ['外部参照追加', 'external.ref.added', { module: 'external_identifier', ref: 'ext-1', act: 'introduce', scheme: 'doi', value: '10.xxxx/xxxx' }],
    ['アドレス記述', 'address.described', { module: 'address', ref: 'addr-1', act: 'introduce', kind: 'public-location', value: 'https://…' }],
    ['ドメイン記述', 'domain.described', { module: 'domain', ref: 'dom-1', act: 'introduce', label: '…', scope: '…' }],
    ['状態記述', 'state.described', { module: 'state', ref: 'st-1', act: 'introduce', label: 'A', start: '', end: '' }],
    ['状態を連続過程へ再記述', 'state.redescribed', { module: 'state', ref: 'st-continuous', act: 'redefine', description: 'A と B を単一の連続過程として再記述', replaces_refs: ['st-1', 'st-2'] }],
    ['遷移記述', 'transition.described', { module: 'transition', ref: 'tr-1', act: 'introduce', relation_kind: 'precedes', from_ref: 'st-1', to_ref: 'st-2' }],
    ['遷移分類の撤回', 'transition.withdrawn', { module: 'transition', ref: 'tr-1', act: 'withdraw', description: '遷移として分類すること自体が不適切だった' }],
    ['発火記述', 'ignition.described', { module: 'ignition', ref: 'ig-1', act: 'introduce', what: '…', under_conditions: '…', at_time: '', scale: '', boundary: '', address_or_domain: '' }],
    ['発火の停止', 'ignition.suspended', { module: 'ignition', ref: 'ig-1', act: 'stop', reason: '…' }],
    ['発火の再発火', 'ignition.reignited', { module: 'ignition', ref: 'ig-1', act: 'apply', reason: '…' }],
    ['発火分類の撤回', 'ignition.withdrawn', { module: 'ignition', ref: 'ig-1', act: 'withdraw', description: '発火としての分類そのものを撤回' }],
    ['関係追加', 'relation.asserted', { module: 'relation', ref: 'rel-1', act: 'introduce', relation_type: 'stores', subject: '…', object: 'this', scope: '', conditions: '' }],
    ['系列判定', 'series.judged', { module: 'series', ref: 'ser-1', act: 'introduce', judgement: 'same-series', members: ['tii:…'], reason: '…' }],
    ['系列所属への異議', 'series.judged', { module: 'series', ref: 'ser-1', act: 'dispute', judgement: 'dispute', reason: '…' }],
    ['系列概念の不採用', 'series.judgement.withdrawn', { module: 'series', ref: 'ser-1', act: 'withdraw', description: '系列概念自体を本記録では不採用' }],
    ['境界変更', 'boundary.changed', { module: 'boundary', ref: 'bnd-1', act: 'replace', label: '…', extent: '…', note: '対象範囲・同一性判定が変わりうる' }],
    ['分岐記録', 'branch.recorded', { module: 'series', ref: 'ser-branch', act: 'introduce', judgement: 'split', members: ['tii:…', 'tii:…'] }],
    ['統合記録', 'merge.recorded', { module: 'series', ref: 'ser-merge', act: 'introduce', judgement: 'merge', members: ['tii:…', 'tii:…'] }],
    ['異議追加', 'dispute.raised', { about_event: 'evt_…', reason: '…' }],
    ['記録訂正（旧は保持）', 'record.corrected', { note: '誤ったメタデータの訂正', corrected_fields: {} }],
    ['解釈の改訂', 'interpretation.revised', { description: 'このTIIが何を追跡していると解釈されるかの改訂' }],
    ['停止', 'tii.suspended', { reason: '…' }],
    ['撤回 / 誤発行', 'tii.retracted', { reason: '誤発行のため撤回（文字列と履歴は保持）' }],
    ['非公開化', 'tii.made-nonpublic', { reason: '…' }],
    ['管理主体変更 / 権限移管', 'authority.transferred', { from: '…', to: '…', reason: '…' }],
  ];

  const quickHtml = quick
    .map(
      ([label, type, content], i) =>
        `<tr><td>${esc(label)}</td><td class="mono">${esc(type)}</td>
<td><button type="button" onclick='fill(${i})'>フォームへ</button></td></tr>`
    )
    .join('');

  const body = `
<h1>管理画面</h1>
<p class="muted">${token_required ? '書込には X-TII-Token ヘッダ / token フィールドが必要。' : '書込トークン未設定（単一管理者ローカル運用）。'}
 一度発行したTIIそのものは通常削除しない。削除要求・誤発行は撤回/停止/非公開化イベントとして処理する。</p>

<div class="grid">
<div>
<h2>1. 新規TII発行</h2>
<form method="POST" action="/admin/issue">
<label>記録主体</label><input name="recorder" required placeholder="admin">
<label>トークン（必要な場合）</label><input name="token">
<label>追跡開始メモ</label><input name="note">
<button>発行</button></form>

<h2>2. ファイル内容ハッシュ計算</h2>
<form method="POST" action="/admin/hash-file">
<label>サーバ上のファイルパス</label><input name="path" required placeholder="/path/to/file">
<button>SHA-256 計算</button></form>
<p class="muted">結果を下のイベント内容へ貼り付けて content.hash.recorded として登録する。</p>
</div>

<div>
<h2>3. イベント追加（すべての記録はこれに還元される）</h2>
<form method="POST" action="/admin/event" id="ef">
<label>対象 TII</label><input name="tii" list="tiis" required placeholder="tii:…">
<datalist id="tiis">${tiiOptions}</datalist>
<label>event_type（自由文字列 / 既知型は候補表示）</label>
<input name="event_type" list="etypes" required value="record.added">
<datalist id="etypes">${eventTypeOptions}</datalist>
<label>記録主体</label><input name="recorder" required placeholder="admin">
<label>トークン</label><input name="token">
<label>content (JSON)</label><textarea name="content">{
  "module": "note",
  "description": "…"
}</textarea>
<label>basis / 根拠 (JSON配列)</label><textarea name="basis" style="min-height:60px">[]</textarea>
<label>external_refs (JSON配列, 任意)</label><textarea name="external_refs" style="min-height:60px">[]</textarea>
<label>content_verification (JSON, 任意)</label><input name="content_verification" placeholder='{"algo":"sha256","value":"…"}'>
<label>supersedes (訂正対象 event_id, 任意)</label><input name="supersedes">
<button>イベント追加</button></form>
</div>
</div>

<h2>クイック入力（要件16の全操作 — いずれも内部的にはイベント記録）</h2>
<table><tr><th>操作</th><th>event_type</th><th></th></tr>${quickHtml}</table>

<h2>書き出し</h2>
<ul>
<li><a href="/export/ledger.jsonl">台帳全体 (JSON Lines)</a> — 正本形式</li>
<li><a href="/export/ledger.json">台帳全体 (JSON)</a></li>
<li><a href="/export/ledger.csv">台帳全体 (CSV, イベント平坦化)</a></li>
<li><a href="/verify">監査（ハッシュ連鎖検証）</a></li>
</ul>
<p class="muted">静的再構築: <code>node bin/tii.js rebuild-static</code></p>

<script>
var QUICK=${JSON.stringify(quick.map(([l, t, c]) => ({ t, c })))};
function fill(i){var q=QUICK[i];document.querySelector('#ef [name=event_type]').value=q.t;
document.querySelector('#ef [name=content]').value=JSON.stringify(q.c,null,2);
document.querySelector('#ef').scrollIntoView({behavior:'smooth'});}
</script>
`;
  return page('TII 管理', body);
}

module.exports = {
  esc,
  page,
  renderIndexPage,
  renderResolutionPage,
  renderSpecPage,
  renderAdminPage,
};
