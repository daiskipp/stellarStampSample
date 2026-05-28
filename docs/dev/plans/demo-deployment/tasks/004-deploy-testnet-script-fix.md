---
id: "004"
title: "scripts/deploy-testnet.sh を wasm32v1-none + 新 env スキーマに更新"
status: done
priority: 2
dependencies: []
estimated_complexity: medium
---

# Task: scripts/deploy-testnet.sh を wasm32v1-none + 新 env スキーマに更新

## Goal

`bash scripts/deploy-testnet.sh` で Stellar Testnet に 5 contracts を deploy し、`.env.testnet` を **完全形**（HQ SA placeholder + 全 rule id key + RP 情報）で出力する。現状の `wasm32-unknown-unknown` ビルドだと state-changing コールが `UnreachableCodeReached` で trap するため修正必須。

## Interfaces

```bash
# scripts/deploy-testnet.sh 差分要点

# 1. WASM ターゲット修正                              # 🔵 (CLAUDE.md ルール)
- WASM_DIR="target/wasm32-unknown-unknown/release"
+ WASM_DIR="target/wasm32v1-none/release"

# 2. ビルドコマンド差し替え                            # 🔵
- cargo build --release --target wasm32-unknown-unknown
+ stellar contract build

# 3. .env.testnet テンプレ完全化                       # 🔵
cat > .env.testnet <<EOF
VITE_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Contracts (生成値)
VITE_VISIT_STAMPS_CONTRACT=${VS_ID}
VITE_BEANS_TOKEN_CONTRACT=${BEANS_ID}
VITE_BENEFITS_CONTRACT=${BEN_ID}
VITE_BADGES_CONTRACT=${BADGE_ID}
VITE_REWARD_POLICY_CONTRACT=${POLICY_ID}

# Smart Account infra (Testnet 固定値)               # 🔵
VITE_ACCOUNT_WASM_HASH=...
VITE_WEBAUTHN_VERIFIER_ADDRESS=...
VITE_ED25519_VERIFIER_ADDRESS=...
VITE_NATIVE_TOKEN_CONTRACT=...

# HQ SA / staff rules (Task 005 で書き戻し)
VITE_HQ_SMART_ACCOUNT=
VITE_HQ_STAFF_CONTEXT_RULE_ID=
VITE_HQ_STAFF_RULE_IDS=
VITE_HQ_STAFF_BENEFITS_RULE_ID=
VITE_DEMO_CUSTOMER_SA=

# RP                                                 # 🔴 CF Pages デプロイ時に host へ書換
VITE_RP_ID=localhost
VITE_RP_NAME=dicekey Coffee Stamps
EOF
```

## Test Strategy

- [ ] `stellar keys generate dicekey-admin --network testnet` で identity が無ければ生成
- [ ] friendbot 経由で `dicekey-admin` の Testnet account に資金注入
- [ ] `stellar contract build` で 5 wasm が `target/wasm32v1-none/release/` に出力
- [ ] `stellar contract deploy` で 5 contract id が Testnet に生成され、stdout に出る
- [ ] `.env.testnet` が生成され、全キーが揃う（HQ SA 系は空のまま、Task 005 で埋まる）
- [ ] エッジケース: 既存 `.env.testnet` がある場合、上書き確認プロンプト or `.env.testnet.bak` に退避
- [ ] エッジケース: cargo / stellar CLI が無い場合は早期エラー

## Implementation Notes

- 参照すべき既存コード:
  - `scripts/deploy-localnet.sh`（理想形、wasm32v1-none ベース）
  - `scripts/deploy-testnet.sh`（現状）
  - CLAUDE.md「Gotchas」セクション
- 実装のヒント:
  - Testnet の Smart Account infra アドレス（accountWasmHash, verifier 等）は OZ 公開値。`.oz-build/` 配下から取得 or smart-account-kit リポジトリの spec を参照
  - `stellar contract deploy --network testnet --source dicekey-admin --wasm ...` を 5 回ループ
  - 各 contract id を `jq` 不要で simple `sed` で `.env.testnet` に注入
- 注意事項:
  - localnet 用 `deploy-localnet.sh` は触らない
  - identity 名 `dicekey-admin` を維持（既存ドキュメントとの整合）

## Files

- 変更: `scripts/deploy-testnet.sh`
- 出力（実行時）: `.env.testnet`（gitignore 対象、コミット禁止）
- テスト: 手動検証 + Testnet explorer で contract id 確認
