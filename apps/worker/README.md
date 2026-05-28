# dicekey-relayer Worker

> Phase 1.5 — Cloudflare Workers 上の Hono relayer。kit の `relayerUrl` 経路で `POST /relayer` を受け、Durable Object `SequenceManager` で fee payer の seq を直列化して Stellar Testnet に submit する。

設計は `docs/dev/plans/demo-deployment/plan.md` を、ローカル実装は `src/` を参照。本 README は **deploy + 運用手順**（Task 012）を扱う。

## アーキテクチャ概要

```
[ *.pages.dev (customer / staff) ]
    │ kit.signAndSubmit → relayerUrl 経路（VITE_WORKER_URL 設定時）
    ▼
[ Worker: dicekey-relayer.<account>.workers.dev ]
  POST /relayer
   ├─ Origin allowlist (ALLOWED_ORIGINS)
   ├─ Inner-tx contract allowlist (ALLOWED_CONTRACTS) ← invokeContract のみ
   ├─ SequenceManager DO で next seq 取得（race-free）
   ├─ fee payer secret で sign（FEE_PAYER_SECRET, secret store）
   └─ rpc.sendTransaction + pollTransaction
```

詳細プロトコル: `src/relayer-handler.ts`（kit `RelayerRequest`/`RelayerResponse` 準拠）。

## ⚠️ 安全ルール（最初に読む）

- **fee payer secret は絶対に commit しない**。`wrangler secret put FEE_PAYER_SECRET` でのみ投入し、`.dev.vars` を作る場合は `.gitignore` に含まれていることを確認（リポジトリ `.gitignore` の `.env` ルールではカバーされないので注意 → 後述）。
- `wrangler.toml` の `[vars]` は **公開される**（Worker のレスポンスヘッダ等に出ない値も `wrangler deploy` 経由で CF にアップロードされる）。secret なものは `[vars]` に書かない。
- `ALLOWED_CONTRACTS` を空（`""`）で deploy すると **すべての invokeContract が通る**（dev 想定の挙動）。本番 deploy では必ず埋めること。

---

## 前提

| 項目 | 確認 |
|------|------|
| Task 008–011 完了（Worker 実装 + SDK relayerUrl 連携） | ✅ |
| `scripts/deploy-testnet.sh` 実行済み（`.env.testnet` に contract id 5 件） | 必須 |
| `scripts/sa-setup-testnet.mjs` 実行済み（`.env.testnet` に HQ SA / staff rule ids） | 必須 |
| Cloudflare アカウント + `wrangler login` 済み | 必須 |
| `stellar` CLI に `testnet` network alias | 必須 |
| `apps/customer-app` / `apps/staff-app` が CF Pages 上に公開済み（Task 006/007） | 必須 |

`apps/worker` でのコマンドは `cd apps/worker` 配下で実行する前提（明示する箇所もあり）。

---

## 1. fee payer 鍵の生成 + Testnet fund

Worker が tx を sign するための専用 G-address を **本 Worker 専用に新規生成**（kit の deterministic deployer `GAAH4OT3...` とは別）。理由: Worker が drain された場合の影響を localnet 開発と分離するため、また OZ Relayer 正式移行時に廃棄しやすくするため。

```bash
# 1.1 鍵生成
stellar keys generate dicekey-relayer-fee-payer --network testnet

# 1.2 公開アドレス確認
stellar keys address dicekey-relayer-fee-payer
# → GXXX...

# 1.3 friendbot で fund（idempotent）
curl "https://friendbot.stellar.org/?addr=$(stellar keys address dicekey-relayer-fee-payer)"
# レスポンスに "createAccountAlreadyExist" が含まれる場合は既に fund 済み（OK）
```

Testnet が reset されると残高が消える → 「Testnet reset 時の再 fund」（後述）を実施。

---

## 2. Worker secret + vars の投入

### 2.1 `FEE_PAYER_SECRET`（secret）

```bash
cd apps/worker
SECRET=$(stellar keys secret dicekey-relayer-fee-payer)
echo "$SECRET" | wrangler secret put FEE_PAYER_SECRET
# 確認:
wrangler secret list
```

`$SECRET` を別ファイルに保存する場合は **絶対に repo 内に置かない**。

### 2.2 `ALLOWED_CONTRACTS`（var, csv）

`.env.testnet` の以下 6 値を CSV にした文字列を `wrangler.toml [vars]` に書く。手書きはエラーを生むのでヘルパースクリプトで同期する：

```bash
# プロジェクトルートで実行
node scripts/sync-worker-allowed-contracts.mjs
# → apps/worker/wrangler.toml の ALLOWED_CONTRACTS = "..." を上書き
# → 標準出力に CSV を表示

# 出力だけ確認したい場合:
node scripts/sync-worker-allowed-contracts.mjs --print
```

スクリプトが参照するキー:

```
VITE_VISIT_STAMPS_CONTRACT
VITE_BEANS_TOKEN_CONTRACT
VITE_BENEFITS_CONTRACT
VITE_BADGES_CONTRACT
VITE_REWARD_POLICY_CONTRACT
VITE_HQ_SMART_ACCOUNT
```

任意のいずれかが空だとスクリプトは失敗するので、`scripts/sa-setup-testnet.mjs` 完了後に実行する。

### 2.3 `ALLOWED_ORIGINS` の更新（必要なら）

CF Pages の host が `dicekey-customer-app.pages.dev` / `dicekey-staff-app.pages.dev` 以外（preview deploy 等）になっている場合、`wrangler.toml` の `ALLOWED_ORIGINS` を編集してから deploy する。

### 2.4 `RPC_URL` / `NETWORK_PASSPHRASE`

Testnet 固定値なので通常変更不要。Stellar が Testnet RPC URL を変える等あれば編集。

---

## 3. Wrangler deploy

```bash
cd apps/worker

# 3.1 (任意) 型チェック / テストを通しておく
pnpm typecheck
pnpm test       # node:test、live RPC は呼ばない

# 3.2 deploy
wrangler deploy
# → 出力に Published URL が出る:
#    https://dicekey-relayer.<account>.workers.dev
```

`<account>` は Cloudflare アカウントの workers subdomain（CF ダッシュボード `Workers & Pages` 上部に表示）。

### Durable Object migration の確認

`wrangler.toml` の `[[migrations]] tag = "v1" new_classes = ["SequenceManager"]` は Task 008 で投入済み。再 deploy で migration が **再適用されることはない**（CF が tag で重複判定）。

migrations を追加する場合（fee payer 切替時の DO reset 等、後述）は新規 `tag` を割り当てる必要がある。

---

## 4. CF Pages 側に `VITE_WORKER_URL` を設定 → 再 deploy

`apps/customer-app` / `apps/staff-app` の両 CF Pages プロジェクトで以下を実施。

### 4.1 環境変数追加

| Key | Value |
|-----|-------|
| `VITE_WORKER_URL` | `https://dicekey-relayer.<account>.workers.dev/relayer` |

末尾の `/relayer` は **含める**（`packages/sdk/src/smart-account.ts` の `createKit` がそのまま `relayerUrl` として kit に渡し、kit が verbatim で POST する）。

### 4.2 再 deploy

CF Pages のダッシュボード `Deployments` で `Retry deployment`、または該当ブランチに空コミットを push して再ビルド。

`VITE_WORKER_URL` が空だと kit は relayer 経由を使わず直接 RPC に submit する（localnet/dev 互換）。値が設定された build 以降だけが Worker 経由になる。

---

## 5. 受け入れチェック

`docs/dev/plans/demo-deployment/tasks/012-worker-wrangler-deploy.md` の Test Strategy と対応。

### 5.1 deploy 成功

- [ ] `wrangler deploy` が緑で完了し URL が表示される

### 5.2 CORS preflight

```bash
curl -i -X OPTIONS https://dicekey-relayer.<account>.workers.dev/relayer \
  -H "Origin: https://dicekey-customer-app.pages.dev" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

- [ ] `204` が返る
- [ ] `Access-Control-Allow-Origin: https://dicekey-customer-app.pages.dev`
- [ ] 不正 origin（例: `https://evil.example.com`）で `Allow-Origin` が付かないこと

### 5.3 健康確認

```bash
curl -s https://dicekey-relayer.<account>.workers.dev/health
# → ok
```

### 5.4 公開 customer-app から passkey 新規作成が完走

- [ ] DevTools Network タブで `POST https://dicekey-relayer.<account>.workers.dev/relayer` が観測される
- [ ] レスポンスが `{ success: true, hash: "...", status: "SUCCESS" }` 形式
- [ ] ホーム到達 → スタンプ枚数（0）が表示される

### 5.5 公開 staff-app から issue 完走

- [ ] staff sign-in → スタンプ発行 → `通算スタンプ ≥ 1`, `beans ≥ 10`

### 5.6 **複数同時 createWallet で `tx_bad_seq` が出ない（DoD）**

最重要受け入れ項目。Phase 1.5 全体の目的。

```text
手順:
  1. customer-app を 2-5 個のブラウザタブ / 別 PC で開く
  2. 各タブで「パスキーで新規作成」をほぼ同時クリック（数秒以内）
  3. 全タブが SUCCESS になることを確認
```

- [ ] 全 createWallet が成功
- [ ] `wrangler tail` で `tx_bad_seq` を含むエラーが出ていない
- [ ] DO `SequenceManager` のログで seq が単調増加していること

### 5.7 エッジケース: Testnet 一時停止時のエラー

Testnet が一時停止 / RPC エラー時、Worker のレスポンスに `errorCode` が含まれること:

- [ ] `SIMULATION_FAILED` または `ONCHAIN_FAILED` が `errorCode` フィールドで返る
- [ ] kit が `Network Error` ではなく具体的なメッセージで失敗

---

## 運用手順

### Testnet reset 時の再 fund 手順

Stellar Testnet は定期的に reset され、fee payer 残高が消える。`wrangler tail` で残高不足エラーを検知したら:

```bash
# 残高確認
curl -s "https://soroban-testnet.stellar.org" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLedgerEntries","params":{"keys":["..."]}}'
# (簡便には Stellar Laboratory / stellar-expert で確認)

# 再 fund
curl "https://friendbot.stellar.org/?addr=$(stellar keys address dicekey-relayer-fee-payer)"
```

reset 後は **DO `SequenceManager` の cached seq が古い** ため、初回 tx は seq 取得を rpc 側に fallback → 自動回復するはず（`src/sequence-manager.ts` の resync ロジック）。それでも詰まる場合は DO reset（後述）。

### ALLOWED_CONTRACTS の更新タイミング（contracts 再 deploy 時）

`scripts/deploy-testnet.sh` を再実行して contracts を Testnet に再 deploy した場合 → `.env.testnet` の contract id がすべて変わる。

```bash
# 1. 再 deploy
bash scripts/deploy-testnet.sh
node scripts/sa-setup-testnet.mjs   # HQ SA も新規になる

# 2. Worker var を同期
node scripts/sync-worker-allowed-contracts.mjs

# 3. CF Pages の env vars（VITE_*_CONTRACT, VITE_HQ_SMART_ACCOUNT, etc.）を
#    手動で更新 → 両 app を再 deploy（cf-pages-runbook.md 参照）

# 4. Worker を再 deploy
cd apps/worker
wrangler deploy
```

旧 HQ SA に対する `__check_auth` ベースの seq は無効になるが、Worker は外側 tx の seq のみ管理するので影響なし。

### Durable Object reset 手順（fee payer 切替時など）

fee payer 鍵を変えた場合、DO がキャッシュしている seq は旧 fee payer のもの → 新鍵で `tx_bad_seq` を出す。RPC resync ロジックで自動回復するはずだが、即座に整合させたい場合は migration で DO を再作成する:

```toml
# wrangler.toml に追記
[[migrations]]
tag = "v2-reset-seq"
deleted_classes = ["SequenceManager"]

[[migrations]]
tag = "v3-reset-seq"
new_classes = ["SequenceManager"]
```

```bash
wrangler deploy
# v2, v3 が順に適用され DO ストレージが空になる
```

完了後、`v2`/`v3` の migration ブロックは **残したまま**にする（CF は tag で適用済み判定するため削除すると差し戻し相当になる）。

### ログ確認

```bash
cd apps/worker
wrangler tail                                  # リアルタイム
wrangler tail --format json                    # JSON
wrangler tail --status error                   # error のみ
```

---

## ローカル動作確認（任意）

CF にデプロイせず Worker を localhost で動かす場合:

```bash
cd apps/worker
# secret は .dev.vars で渡す（.dev.vars を .gitignore に追加）
echo "FEE_PAYER_SECRET=$(stellar keys secret dicekey-relayer-fee-payer)" > .dev.vars
wrangler dev   # http://localhost:8787
```

`.dev.vars` の値は public repo の `.gitignore` で個別に弾く想定（プロジェクト `.gitignore` の `.env` ルールは `.dev.vars` をカバーしない）。

```bash
# プロジェクトルートの .gitignore に追加
echo "apps/worker/.dev.vars" >> .gitignore
```

---

## 既知の制約 / 将来の移行

| 項目 | 現状 | 解消予定 |
|------|------|----------|
| fee payer secret が CF 側に保管 | OZ Relayer 正式統合前の暫定 | Phase 2 で OZ Relayer 移行（本 Worker は廃止可能な構造を維持） |
| ALLOWED_CONTRACTS の手動同期 | `sync-worker-allowed-contracts.mjs` 実行が必要 | CD で自動化 |
| Testnet reset 時の fund 再実行 | 手動 | 監視 + 自動 fund job（未着手） |
| Worker → kit の RP_ID 制約 | customer/staff で別 RP | Phase 1 設計通り（cf-pages-runbook.md 参照） |

## References

- 計画: `docs/dev/plans/demo-deployment/plan.md`
- タスク: `docs/dev/plans/demo-deployment/tasks/012-worker-wrangler-deploy.md`
- CF Pages 手順: `docs/dev/plans/demo-deployment/cf-pages-runbook.md`
- 設計原典: `docs/design/dicekey-coffee-stamps/smart-account-integration.md`
- kit relayer プロトコル: `.oz-build/smart-account-kit/src/relayer.ts`
