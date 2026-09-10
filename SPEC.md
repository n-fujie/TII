# TII 公開仕様書（PROVISIONAL / 試験版）

**Transition-Ignition Identifier — 遷移発火識別子**
仕様版：`0.1.0-draft`　状態：試験用（本番発行前）

本仕様は実装と同時に作成された（要件22）。確定するまで、本実装が発行する
すべての識別子は **試験用識別子（`identifier_status: "test"`）** である（要件28）。

---

## 1. TIIが保証しないこと（要件22）

TIIは、次のいずれも **単独では保証しない**。

- 対象の本質的同一性
- 所有権
- 真正性
- 学術的正当性
- 識別子文字列自体の性質としての永続性

TIIは、次のいずれも **普遍的存在論単位としない**。

- 状態（state）
- 遷移（transition）
- 発火（ignition）
- アドレス（address）／配置
- ドメイン（domain）
- 境界（boundary）
- 系列（series）／系譜

これらは **必要な場面で採用される、改訂可能な作動記述** である。
TII自身が使用する語彙もまた、最終的・不可逆的なものとして扱わない。

---

## 2. TIIが最低限意味すること

TIIの付与は **「この参照点から追跡を開始した」** ことだけを意味する。

- 1つのTIIが後に複数系列へ分離されてよい。
- 複数のTIIが後に1系列として統合判定されてよい。
- TII文字列は変更しないが、「何を追跡していると解釈されているか」は改訂可能。
- 根TII ≠ 一系列（要件4）。

---

## 3. 識別子構文（PROVISIONAL）

| 項目 | 暫定値 | 確定状況 |
|------|--------|----------|
| 正式名称 | Transition-Ignition Identifier | 未確定 |
| 略称 | TII | 未確定 |
| 名前空間 | `tii:` | 未確定 |
| 識別子構文 | `tii:` + 本体 | 未確定 |
| 本体文字数 | 12 | 未確定 |
| 許可文字 | `0-9 a-h j k m n p-t v-z`（Crockford風、`i l o u` 除外） | 未確定 |
| 大文字小文字規則 | 小文字正規化、比較は小文字 | 未確定 |
| 乱数生成方式 | CSPRNG + 棄却サンプリング | 未確定 |
| 衝突処理 | 台帳全体照合、最大1000回再試行、失敗時エラー | 未確定 |
| 解決URL | `https://<host>/tii/<id>` | 未確定 |
| 失効処理 | `tii.retracted` / `tii.suspended` イベント（文字列は保持） | 未確定 |
| 移管処理 | `authority.transferred` イベント | 未確定 |
| 仕様版管理 | 本文書冒頭の `仕様版` | 未確定 |
| 長期継承方針 | `ledger.jsonl` の保全と再構築（§7） | 未確定 |

文字列に埋め込んではならないもの：組織名・個人名・所有主体・発行年・場所・国・
対象カテゴリー・論文種別・版番号・アドレス・ドメイン・理論名・発火状態・遷移状態。

---

## 4. データモデル

### 4.1 コアイベント（必須10項目のみ）

```jsonc
{
  "event_id": "evt_...",              // 不透明
  "tii": "tii:...",                   // 対象TII
  "seq": 0,                           // 台帳内連番
  "recorded_at": "2026-01-01T00:00:00.000Z",   // 主張時刻
  "ledger_written_at": "2026-01-01T00:00:00.000Z", // 台帳書込時刻
  "recorder": { "id": "...", "kind": "person|mechanism|..." },
  "event_type": "自由文字列",
  "content": { },                    // 記録内容（任意構造）
  "basis": [ ],                      // 証拠・根拠への参照
  "external_refs": [ ],              // 外部参照（任意）
  "content_verification": { "algo": "sha256", "value": "..." }, // 任意
  "supersedes": "evt_...",           // 訂正対象（任意、旧記録は保持）
  "prev_event_for_target": "evt_...",// 同一TIIの直前イベント
  "prev_hash": "<hex>",              // 直前台帳イベントのhash
  "hash": "<hex>"                    // 本イベント内容のhash
}
```

`content` に置かれた `module` / `ref` / `act` 以外を、エンジンは特権化しない。

### 4.2 ハッシュ連鎖

```
hash = SHA-256( prev_hash + canonicalJSON(event without "hash") )
canonicalJSON = キーを再帰的に辞書順ソートした決定的 JSON
genesis prev_hash = "0" * 64
```

`GET /verify` / `node bin/tii.js verify` が全連鎖を再計算し、
内容改変・行削除・並替を検出する。ブロックチェーンは用いない（要件21）。

---

## 5. 記述モジュール（すべて任意）

`content` に次を置くと、投影・解決ページ・API がモジュールとして扱う。
モジュール名・`act` 値はいずれも **開いた集合**。

```jsonc
{ "module": "...", "ref": "...", "act": "introduce|apply|hold|stop|replace|redefine|dispute|withdraw|...",
  "description": "...", "...": "モジュール固有フィールド" }
```

| module | 主な固有フィールド | 備考 |
|--------|--------------------|------|
| `state` | `label`, `from`, `to`, `predecessor_refs` | 離散状態を仮定しない |
| `transition` | `relation_kind`(前後/派生/分岐/統合/置換/停止/再開/撤回/再接続/循環/不明/異議あり/…), `from_ref`, `to_ref` | A→Bを存在論的事実に固定しない |
| `ignition` | `what`, `under_conditions`, `at_time`, `scale`, `boundary`, `address_or_domain` | 物理的燃焼を意味しない／真偽値に還元しない |
| `address` | `kind`(公開場所/保存場所/ネットワーク位置/取得経路/物理所在/論理位置), `value` | 複数可／正本を自動特権化しない |
| `domain` | `label`, `scope` | アドレスと同一視しない |
| `boundary` | `label`, `extent` | 変更で同一性・関係判定が変わるのは正常 |
| `scale` | `label`, `value` | |
| `timespan` | `start`, `end`, `label` | 異なる区間から別記述が成立してよい |
| `relation` | `relation_type`(管理/保存/アクセス/変更/複製/配布/維持/停止/削除/移管/署名/著作権保持/資金提供/公開/検証/…), `subject`, `object`, `scope`, `conditions` | 単一 `owner` 属性を設けない |
| `series` | `judgement`(same/different/unknown/dispute/split/merge/withdraw), `members`(tii配列), `reason` | 記録対象でなく判定 |
| `external_identifier` | `scheme`(doi/ark/isbn/orcid/url/ipfs-cid/…), `value` | `external_refs` でも可 |
| `interpretation` | `description` | 「何を追跡しているか」の改訂 |

記録の無いモジュールは表示しない（要件24）。

---

## 6. 証拠 / 判定 / 表示の分離（要件18）

1. **証拠**：`basis`, `content_verification`, `external_refs`
2. **判定**：`recorder` による `content`（`act`, `relation_kind`, `judgement` 等）
3. **表示**：`projection.js` が再計算する「現在有効と解釈される記録」

システムは証拠から唯一の存在論的結論を自動生成しない。
`証拠 → 判定 → 異議 → 撤回` の全履歴を保持する。

---

## 7. 保存と移植性（要件20, 27）

- 正本：`data/ledger.jsonl`（追記型、1行1イベント、UTF-8）。
- 書き出し：`JSON` / `JSON Lines` / `CSV`。
- 静的再構築：`node bin/tii.js rebuild-static` → `dist/`（HTML + JSON + `ledger.jsonl`）。
- 依存関係ゼロ。特定クラウド企業の非公開機能を再実装の必須にしない。
- ホスティング／DB製品が変わっても `ledger.jsonl` から同一状態・同一TII文字列で再構築可能。

---

## 8. 削除・誤発行の扱い（要件16, 23）

一度発行したTIIそのものは通常削除しない。削除要求・誤発行は
`tii.retracted` / `tii.suspended` / `tii.made-nonpublic` 等の **記録イベント** として処理する。
過去記録は失われない。

---

## 9. 本番発行前の必須監査（要件27）

本番公開前に §3 の全項目を確定し、次を確認する。

- 既存PID（DOI/ARK/DID/内容ハッシュ/来歴記録）との差異を過大主張していない／藁人形化していない。
- 状態・遷移・発火・配置・アドレス・ドメイン・境界を存在論化していない。
- 所有を固定属性へ戻していない。
- AI・人間・組織等の既成カテゴリーを先行させていない。
- 上位理論よりTIIのデータモデルが硬くなっていない。
- TII自身の概念が将来改訂されても既発行識別子を維持できる。
- 特定クラウド企業から完全移行可能。
- 履歴改変を検出可能。
- 削除・訂正で過去記録が失われない。
- 新規概念を必要以上に追加していない。

後退を検出した場合は本番発行を停止する。
