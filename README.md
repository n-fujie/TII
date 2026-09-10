# TII — Transition-Ignition Identifier / 遷移発火識別子（最小実用版）

> **PROVISIONAL.** 本番発行前の絶対条件（SPEC.md §3）が未確定のため、
> 本実装が発行する識別子はすべて **試験用（`identifier_status: "test"`）** です。

TIIは、固定的対象へ永久番号を付与する仕組みではなく、状態・遷移・発火・アドレス・
ドメイン・境界・系列・所有を世界の普遍的構成単位として宣言する存在論でもありません。

TIIは、**ある参照点について追跡を開始し、その後に採用された記述・判定・関係・変更・停止・
訂正・分岐・統合・再分類等を、消去せず監査可能な履歴として保持する識別・監査インフラ**です。
Ziran Systemその他の上位研究アーキテクチャの下位で発火します。

- 設計（実装前・第1段階）: [DESIGN.md](DESIGN.md)
- 公開仕様書: [SPEC.md](SPEC.md)

## 特徴

| 要件 | 実装 |
|------|------|
| コアを極力薄く（要件2） | 必須10項目のみ。状態/遷移/発火/アドレス/ドメイン/所有/系列はコア必須にしない |
| 不透明識別子（要件3） | `tii:` + 12桁、意味の埋め込みなし、CSPRNG + 棄却サンプリング |
| 追記型イベント（要件5） | `data/ledger.jsonl`（1行1イベント）。上書き・消去なし。訂正は `supersedes` |
| 任意モジュール（要件6–13） | `content.module/ref/act` の規約のみ。エンジンは特権化しない。すべて開いた集合 |
| 証拠・判定・表示の分離（要件18） | `basis` / `recorder`+`content` / `projection.js` の3層 |
| 暗号学的監査（要件21） | SHA-256 ハッシュ連鎖。ブロックチェーン不使用 |
| 移植性（要件20） | 依存関係ゼロ（Node標準ライブラリのみ）。JSON / JSONL / CSV 書き出し。静的再構築可 |
| 破壊試験（要件26） | 25シナリオすべて green（`test/destruction.test.js`） |

## 使い方

```bash
cd tii
node --test                 # 40 tests（core + 25 破壊試験）
npm start                    # http://localhost:3009
```

### CLI

```bash
node bin/tii.js issue --recorder admin --note "追跡開始の理由"
node bin/tii.js list
node bin/tii.js hash-file ./somefile.pdf
node bin/tii.js append --file event.json
node bin/tii.js show tii:xxxxxxxxxxxx
node bin/tii.js verify                 # ハッシュ連鎖検証（改変時 exit 1）
node bin/tii.js export jsonl > backup.jsonl
node bin/tii.js rebuild-static ./dist  # 台帳だけから静的サイト再構築
```

### HTTP / API（イベント中心）

| メソッド・パス | 用途 |
|----------------|------|
| `GET /` | トップ（検索・発行・最近の記録・仕様） |
| `GET /tii/:id` | 解決ページ（HTML）。`.json` または `/data` で構造化データ |
| `POST /api/tii` | TII発行 |
| `GET /api/tii/:id` | 概要 |
| `POST /api/tii/:id/events` | イベント追加 |
| `GET /api/tii/:id/events` `/history` `/relations` `/references` | 各取得 |
| `GET /admin` | 管理画面（発行・イベント・ハッシュ計算・書き出し） |
| `GET /verify` | ハッシュ連鎖検証 |
| `GET /export/ledger.{jsonl,json,csv}` / `GET /export/static` | 書き出し |

状態・遷移・発火・アドレス等に専用APIは設けていません。すべて
`POST /api/tii/:id/events` に還元されます（要件17）。

### 環境変数

- `PORT`（既定 3009）
- `TII_LEDGER`（既定 `data/ledger.jsonl`）
- `TII_ADMIN_TOKEN`（未設定なら単一管理者ローカル運用。設定時は書込に `X-TII-Token` / `token` 必須）

## モジュール記述の形

```jsonc
POST /api/tii/tii:xxxx/events
{
  "event_type": "ignition.described",   // 自由文字列（未知型も保存）
  "recorder": "researcher-1",
  "basis": ["file://evidence-A"],
  "content": {
    "module": "ignition",               // 開いた集合
    "ref": "ig-1",                       // 同一被記述項目のグルーピングID
    "act": "introduce",                  // introduce|apply|hold|stop|replace|redefine|dispute|withdraw|...
    "what": "規則Rが指定条件下で作動上有効になった",
    "under_conditions": "…"
  }
}
```

発火は物理的燃焼を意味せず、真偽値へ還元されません。「未評価／発火記録あり／
停止記録あり／異議あり」等は表示ラベルであり、データモデルの存在論的状態集合ではありません。

## デプロイ（読み取り専用ミラー）

TIIの正本は追記型ファイル `data/ledger.jsonl` です。サーバレス環境（Vercel等）の
ファイルシステムは**読み取り専用かつ揮発性**で、監査台帳を置くと記録が失われるため、
`src/server.js`（書込可能なNodeサーバ）は **ローカル／自前ホスト（永続ボリューム）専用** です。

Vercel には **静的な読み取り専用ミラー** を配信します（要件20：静的ファイル再構築・クラウド非依存）。

- `data/ledger.jsonl` をリポジトリにコミット（＝公開される正本）
- Vercel ビルド: `node bin/tii.js rebuild-static public`（[vercel.json](vercel.json)）
- 配信物: 解決ページ `/tii/<id>`、`/tii/<id>.json`、`/ledger.jsonl`・`/ledger.json`・`/ledger.csv`、`/catalog.json`（検証結果込み）、`/spec`
- **発行・イベント追加はローカル CLI → `git push` → 自動再デプロイ**

```bash
node bin/tii.js issue --recorder me --note "..."
node bin/tii.js append --file event.json
node bin/tii.js verify
git add data/ledger.jsonl && git commit -m "ledger: ..." && git push
```

書込可能なWeb運用が必要な場合は、永続ボリュームのあるホスト（Fly.io / Render / VPS）で
`npm start` を実行してください。

## 最終監査前チェック（要件27）

本番発行前に SPEC.md §3 の全項目を確定し、§9 の監査項目を確認してください。
後退を検出した場合は本番発行を停止します。
