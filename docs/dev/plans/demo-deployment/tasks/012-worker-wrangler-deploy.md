---
id: "012"
title: "Worker を Wrangler で deploy し、CF Pages に VITE_WORKER_URL を設定"
status: done
priority: 5
dependencies: ["011"]
estimated_complexity: low
---

# Task: Worker を Wrangler で deploy し、CF Pages に VITE_WORKER_URL を設定

## Goal

本番 Worker を `dicekey-relayer.<account>.workers.dev` にデプロイし、両 `*.pages.dev` から呼べる状態にする。Phase 1.5 全体の DoD（複数人同時 createWallet/issue で seq 競合無し）を達成。

## Interfaces

```bash
# 1. fee payer 用の新規 G-account 生成 + Testnet fund
stellar keys generate dicekey-relayer-fee-payer --network testnet  # 🔵
stellar keys address dicekey-relayer-fee-payer
# → friendbot で fund (sa-setup-testnet.mjs と同じ手順)
curl "https://friendbot.stellar.org/?addr=$(stellar keys address dicekey-relayer-fee-payer)"

# 2. Worker secret 投入
cd apps/worker
SECRET=$(stellar keys secret dicekey-relayer-fee-payer)
echo "$SECRET" | wrangler secret put FEE_PAYER_SECRET                # 🔵

# 3. ALLOWED_CONTRACTS を .env.testnet から組み立てて wrangler.toml or wrangler secret に
# Plan: vars に inline で書ける（secret ではない）
# wrangler.toml [vars] の ALLOWED_CONTRACTS に csv で:
#   <visitStamps>,<beansToken>,<benefits>,<badges>,<rewardPolicy>,<HQ_SA>

# 4. deploy
wrangler deploy                                                       # 🔵
# → URL: https://dicekey-relayer.<account>.workers.dev

# 5. CF Pages の VITE_WORKER_URL を両 app に設定 → 再 deploy
# (dashboard or wrangler pages secret put)
# 設定値: https://dicekey-relayer.<account>.workers.dev/relayer
```

```markdown
# README 化する運用手順 (Worker 運用)
1. fee payer 鍵の生成 & Testnet fund 手順
2. Testnet reset 時の再 fund 手順
3. ALLOWED_CONTRACTS の更新タイミング（contracts 再 deploy 時）
4. Durable Object の reset 手順（fee payer 切替時など）
```

## Test Strategy

- [ ] `wrangler deploy` 成功、`*.workers.dev` URL が払い出される
- [ ] `curl -X OPTIONS https://*.workers.dev/relayer -H "Origin: https://dicekey-customer-app.pages.dev"` が CORS preflight OK
- [ ] 公開 customer-app から passkey 新規作成が完走（DevTools で Worker 経由を確認）
- [ ] 公開 staff-app から issue が完走
- [ ] **複数ブラウザ（2-5 タブ）から同時に createWallet を実行 → 全て成功、`tx_bad_seq` 発生せず**
- [ ] エッジケース: Testnet が一時停止した時に Worker のエラーレスポンスが errorCode 付きで返る

## Implementation Notes

- 参照すべき既存コード:
  - `scripts/sa-setup-testnet.mjs` の友達ボット fund ロジック
  - `apps/worker/wrangler.toml`（Task 008 で作成）
- 実装のヒント:
  - 初回 deploy 後、URL を CF Pages 両 app の env に注入 → 再 deploy が必要
  - `wrangler tail` でリアルタイムログ確認
  - DO の migrations は Task 008 で済んでいるはず（new_classes = ["SequenceManager"]）
- 注意事項:
  - fee payer secret は **絶対に git に commit しない**（`.dev.vars` も `.gitignore` 確認）
  - Testnet reset で fee payer balance が消える → 監視 + 再 fund 手順を README に明記
  - 将来 OZ Relayer に移行する際は本 Worker を廃止できる構造を維持

## Files

- 変更: `apps/worker/wrangler.toml`（ALLOWED_CONTRACTS の値を埋める）
- 新規: `apps/worker/README.md`（運用手順を記載）
- 設定: Cloudflare Pages dashboard（両 app の env vars に VITE_WORKER_URL 追加）
- テスト: 公開 URL での手動検証（複数端末・複数ブラウザ）
