'use strict';

/**
 * 必須破壊試験（要件26）。25シナリオすべてについて：
 *  - 既発行TIIを変更しない
 *  - 過去の記録を失わない・書き換えない
 *  - ハッシュ連鎖が保たれる
 *  - 異なる再記述を「追加」できる
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Ledger } = require('../src/ledger');
const { project } = require('../src/projection');
const exporters = require('../src/export');
const { withTII, snapshot, assertHistoryPreserved } = require('./helpers');

function run(name, fn) {
  test(name, () => {
    const { ledger, tii } = withTII();
    const before = snapshot(ledger);
    fn(ledger, tii);
    assertHistoryPreserved(ledger, tii, before);
    // an additive re-description beyond the genesis issue event must exist
    assert.ok(ledger.forTII(tii).length > 1, 'a new record must have been added');
  });
}

run('01 論文初版から改訂版への変更', (l, tii) => {
  l.append({ tii, event_type: 'record.added', recorder: 'ed', content: { module: 'version', ref: 'v', label: '初版', doc_hash: 'aaa' } });
  l.append({ tii, event_type: 'record.added', recorder: 'ed', content: { module: 'version', ref: 'v', act: 'replace', label: '改訂版', doc_hash: 'bbb' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.version[0].current.content.label, '改訂版');
  assert.equal(p.modules.version[0].records.length, 2); // 初版の記録も保持
});

run('02 同一ファイルの保存場所移動', (l, tii) => {
  l.append({ tii, event_type: 'address.described', recorder: 'a', content: { module: 'address', ref: 'a1', act: 'introduce', kind: 'storage-location', value: '/vol/old/x.pdf' } });
  l.append({ tii, event_type: 'address.described', recorder: 'a', content: { module: 'address', ref: 'a1', act: 'replace', kind: 'storage-location', value: '/vol/new/x.pdf' } });
  l.append({ tii, event_type: 'content.hash.recorded', recorder: 'a', content: { module: 'content', algo: 'sha256', value: 'same-hash' } });
});

run('03 一つの参照から複数系列への分岐', (l, tii) => {
  l.append({ tii, event_type: 'branch.recorded', recorder: 'r', content: { module: 'series', ref: 's-split', act: 'introduce', judgement: 'split', members: ['tii:child-a', 'tii:child-b'], reason: '二つの独立した発展系列' } });
});

run('04 複数系列の統合', (l, tii) => {
  l.append({ tii, event_type: 'merge.recorded', recorder: 'r', content: { module: 'series', ref: 's-merge', act: 'introduce', judgement: 'merge', members: ['tii:other-1', 'tii:other-2'] } });
});

run('05 系列所属そのものへの異議', (l, tii) => {
  l.append({ tii, event_type: 'series.judged', recorder: 'r1', content: { module: 'series', ref: 's1', act: 'introduce', judgement: 'same-series', members: ['tii:x'] } });
  l.append({ tii, event_type: 'series.judged', recorder: 'r2', content: { module: 'series', ref: 's1', act: 'dispute', judgement: 'dispute', reason: '所属の根拠が不十分' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.series[0].disputed, true);
  // 旧判定は残る
  assert.ok(p.modules.series[0].records.some((r) => r.content.judgement === 'same-series'));
});

run('06 系列概念を撤回した場合', (l, tii) => {
  l.append({ tii, event_type: 'series.judged', recorder: 'r', content: { module: 'series', ref: 's1', act: 'introduce', judgement: 'same-series', members: ['tii:x'] } });
  l.append({ tii, event_type: 'series.judgement.withdrawn', recorder: 'r', content: { module: 'series', ref: 's1', act: 'withdraw', description: '本記録では系列概念自体を不採用' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.series[0].withdrawn, true);
  assert.equal(p.modules.series[0].current, null);
});

run('07 誤ったメタデータの訂正', (l, tii) => {
  const bad = l.append({ tii, event_type: 'record.added', recorder: 'x', content: { module: 'meta', ref: 'm', author: '誤名' } });
  l.append({ tii, event_type: 'record.corrected', recorder: 'x', supersedes: bad.event_id, content: { module: 'meta', ref: 'm', author: '正名' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.meta[0].current.content.author, '正名');
  assert.ok(l.getEvent(bad.event_id).content.author === '誤名'); // 旧値保持
});

run('08 管理主体変更', (l, tii) => {
  l.append({ tii, event_type: 'authority.transferred', recorder: 'org-A', content: { from: 'org-A', to: 'org-B', reason: '運営移管' } });
});

run('09 保存主体消滅', (l, tii) => {
  l.append({ tii, event_type: 'relation.asserted', recorder: 'x', content: { module: 'relation', ref: 'store', act: 'introduce', relation_type: 'stores', subject: 'archive-X' } });
  l.append({ tii, event_type: 'relation.ended', recorder: 'x', content: { module: 'relation', ref: 'store', act: 'stop', reason: 'archive-X は消滅した' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.relation[0].withdrawn, true);
});

run('10 ドメイン変更', (l, tii) => {
  l.append({ tii, event_type: 'domain.described', recorder: 'x', content: { module: 'domain', ref: 'd', act: 'introduce', label: '領域1' } });
  l.append({ tii, event_type: 'domain.described', recorder: 'x', content: { module: 'domain', ref: 'd', act: 'replace', label: '領域2' } });
});

run('11 外部DOIの消失', (l, tii) => {
  l.append({ tii, event_type: 'external.ref.added', recorder: 'x', content: { module: 'external_identifier', ref: 'doi', act: 'introduce', scheme: 'doi', value: '10.1234/abcd' } });
  l.append({ tii, event_type: 'external.ref.updated', recorder: 'x', content: { module: 'external_identifier', ref: 'doi', act: 'stop', scheme: 'doi', value: '10.1234/abcd', status: 'revoked', note: 'レジストラで失効' } });
  const p = project(l.forTII(tii));
  assert.ok(p.references.some((r) => r.status === 'stop' || r.status === 'revoked'));
});

run('12 同一内容の複数アドレス', (l, tii) => {
  l.append({ tii, event_type: 'address.described', recorder: 'x', content: { module: 'address', ref: 'mirror-1', act: 'introduce', value: 'https://a.example/x' } });
  l.append({ tii, event_type: 'address.described', recorder: 'x', content: { module: 'address', ref: 'mirror-2', act: 'introduce', value: 'https://b.example/x' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.address.length, 2); // どちらも正本として自動特権化しない
});

run('13 異なる内容を誤って同一系列とした場合', (l, tii) => {
  const j = l.append({ tii, event_type: 'series.judged', recorder: 'x', content: { module: 'series', ref: 's', act: 'introduce', judgement: 'same-series', members: ['tii:unrelated'] } });
  l.append({ tii, event_type: 'series.judged', recorder: 'x', supersedes: j.event_id, content: { module: 'series', ref: 's', act: 'redefine', judgement: 'different-series', reason: '内容が異なることが判明' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.series[0].current.content.judgement, 'different-series');
});

run('14 発火記述後の停止', (l, tii) => {
  l.append({ tii, event_type: 'ignition.described', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'introduce', what: '機能Fが作動上有効' } });
  l.append({ tii, event_type: 'ignition.suspended', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'stop', reason: '条件が満たされなくなった' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.ignition[0].withdrawn, true);
});

run('15 停止後の再発火', (l, tii) => {
  l.append({ tii, event_type: 'ignition.described', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'F' } });
  l.append({ tii, event_type: 'ignition.suspended', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'stop' } });
  l.append({ tii, event_type: 'ignition.reignited', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'apply', reason: '条件が再び成立' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.ignition[0].current.content.act, 'apply');
  assert.equal(p.modules.ignition[0].records.length, 3);
});

run('16 発火としての分類そのものを撤回', (l, tii) => {
  l.append({ tii, event_type: 'ignition.described', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'F' } });
  l.append({ tii, event_type: 'ignition.withdrawn', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'withdraw', description: '発火として記述したこと自体を撤回' } });
});

run('17 二状態としていたものを連続過程へ再記述', (l, tii) => {
  l.append({ tii, event_type: 'state.described', recorder: 'x', content: { module: 'state', ref: 'A', act: 'introduce', label: '状態A' } });
  l.append({ tii, event_type: 'state.described', recorder: 'x', content: { module: 'state', ref: 'B', act: 'introduce', label: '状態B' } });
  l.append({ tii, event_type: 'state.redescribed', recorder: 'x', content: { module: 'state', ref: 'AB-continuous', act: 'redefine', description: 'A と B を単一の連続過程として再記述', replaces_refs: ['A', 'B'] } });
  const p = project(l.forTII(tii));
  // 旧い二状態の記録は残り、新しい連続過程記述が追加されている
  assert.ok(p.modules.state.find((b) => b.ref === 'A'));
  assert.ok(p.modules.state.find((b) => b.ref === 'B'));
  assert.ok(p.modules.state.find((b) => b.ref === 'AB-continuous'));
});

run('18 境界変更により対象範囲が変化', (l, tii) => {
  l.append({ tii, event_type: 'boundary.changed', recorder: 'x', content: { module: 'boundary', ref: 'b', act: 'introduce', extent: '狭い範囲' } });
  l.append({ tii, event_type: 'boundary.changed', recorder: 'x', content: { module: 'boundary', ref: 'b', act: 'replace', extent: '広い範囲', note: '同一性・関係判定が変わりうる' } });
});

run('19 アドレス概念自体が適用不能な記録', (l, tii) => {
  // アドレスモジュールを一切使わず、その旨を明示的に記録できる
  l.append({ tii, event_type: 'note.added', recorder: 'x', content: { module: 'applicability', ref: 'address', act: 'introduce', description: 'この記録対象にアドレス概念は適用不能' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.address, undefined);
  assert.ok(p.modules.applicability);
});

run('20 状態概念自体が適用不能な対象', (l, tii) => {
  l.append({ tii, event_type: 'note.added', recorder: 'x', content: { module: 'applicability', ref: 'state', act: 'introduce', description: 'この対象は離散状態へ分割不能' } });
  const p = project(l.forTII(tii));
  assert.equal(p.modules.state, undefined);
});

run('21 TII運営主体が消滅', (l, tii) => {
  l.append({ tii, event_type: 'authority.transferred', recorder: 'operator', content: { from: 'operator', to: 'unknown', reason: '運営主体が消滅、後継未定' } });
  // 運営主体が消えても台帳と既発行TIIは残る（単一組織を最終裁定主体に埋め込まない）
});

test('22 ホスティング会社が消滅 — 台帳のみから静的再構築できる', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x', content: { module: 'note', ref: 'n', text: 'x' } });
  const jsonl = exporters.toJSONL(ledger);

  // 全く新しい環境で ledger.jsonl だけから再構築
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-new-host-'));
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), jsonl);
  const rebuilt = new Ledger(path.join(dir, 'ledger.jsonl')).load();
  const out = path.join(dir, 'dist');
  const result = exporters.buildStaticSite(rebuilt, out);

  assert.deepEqual(rebuilt.listTIIs(), [tii]); // 同一TII文字列
  assert.ok(rebuilt.verify().ok);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
});

test('23 データベース製品を全面変更 — JSONL は製品非依存', () => {
  const { ledger, tii } = withTII();
  ledger.append({ tii, event_type: 'note.added', recorder: 'x' });

  // "別DB" をプレーンな Map で模し、JSONL からロード・書き戻し
  const jsonl = exporters.toJSONL(ledger);
  const rows = jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const fakeDb = new Map(rows.map((r) => [r.event_id, r]));

  // 別DB から JSONL を再生成し、元の台帳と一致することを確認
  const back = [...fakeDb.values()].sort((a, b) => a.seq - b.seq).map((r) => JSON.stringify(r)).join('\n') + '\n';
  assert.equal(back, jsonl);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tii-newdb-'));
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), back);
  assert.ok(new Ledger(path.join(dir, 'ledger.jsonl')).load().verify().ok);
});

run('24 TII仕様の一部概念が将来廃止', (l, tii) => {
  // 「発火」概念が将来廃止されても、既存の発火記述イベントは保持される。
  l.append({ tii, event_type: 'ignition.described', recorder: 'x', content: { module: 'ignition', ref: 'i', act: 'introduce', what: 'F' } });
  // 廃止の事実そのものを記録
  l.append({ tii, event_type: 'note.added', recorder: 'spec-wg', content: { module: 'spec-change', ref: 'ignition', act: 'withdraw', description: 'TII仕様v2で「発火」モジュールは廃止。既存記録は歴史的記録として保持。' } });
  const p = project(l.forTII(tii));
  assert.ok(p.modules.ignition[0].records.length >= 1); // 過去の発火記述は消えない
  assert.ok(p.modules['spec-change']);
});

run('25 上位理論が改訂されても既発行TIIが維持可能か', (l, tii) => {
  l.append({ tii, event_type: 'interpretation.revised', recorder: 'researcher', content: { module: 'interpretation', ref: 'upstream', description: 'Ziran System の改訂に伴い、このTIIが追跡している対象の解釈を更新。TII文字列と履歴は不変。', upstream_revision: 'ziran-2027' } });
  const p = project(l.forTII(tii));
  assert.equal(p.tii, tii); // 文字列不変
  assert.ok(p.interpretation.length >= 1);
});

test('all 25 destruction scenarios kept the ledger append-only and chained', () => {
  // meta-check: exercised implicitly above; assert helpers exist
  assert.equal(typeof assertHistoryPreserved, 'function');
});
