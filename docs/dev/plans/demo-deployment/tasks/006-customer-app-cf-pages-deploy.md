---
id: "006"
title: "customer-app を Cloudflare Pages にデプロイ"
status: done
priority: 3
dependencies: ["001", "004", "005"]
estimated_complexity: medium
---

# Task: customer-app を Cloudflare Pages にデプロイ

## Goal

`*.pages.dev` 上で customer-app を公開し、ホスト Chrome から passkey 新規作成 → スタンプ枚数表示が動作する状態にする。

## Interfaces

```yaml
# Cloudflare Pages dashboard 設定（または wrangler.toml）
project_name: dicekey-customer-app                                # 🔵
production_branch: main
build_command: |
  pnpm install --frozen-lockfile && \
  bash scripts/build-kit.sh && \
  pnpm --filter @dicekey/sdk build && \
  pnpm --filter @dicekey/contracts build && \
  pnpm --filter customer-app build
build_output_directory: apps/customer-app/dist
node_version: 20                                                  # 🔵
pnpm_version: 9

env vars (production):                                            # 🔵 .env.testnet と同期
  VITE_NETWORK: testnet
  VITE_RPC_URL: https://soroban-testnet.stellar.org
  VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
  VITE_VISIT_STAMPS_CONTRACT: <from .env.testnet>
  VITE_BEANS_TOKEN_CONTRACT: ...
  VITE_BENEFITS_CONTRACT: ...
  VITE_BADGES_CONTRACT: ...
  VITE_REWARD_POLICY_CONTRACT: ...
  VITE_ACCOUNT_WASM_HASH: ...
  VITE_WEBAUTHN_VERIFIER_ADDRESS: ...
  VITE_ED25519_VERIFIER_ADDRESS: ...
  VITE_NATIVE_TOKEN_CONTRACT: ...
  VITE_HQ_SMART_ACCOUNT: ...
  VITE_HQ_STAFF_CONTEXT_RULE_ID: ...
  VITE_HQ_STAFF_RULE_IDS: ...
  VITE_HQ_STAFF_BENEFITS_RULE_ID: ...
  VITE_DEMO_CUSTOMER_SA: ...
  VITE_RP_ID: <project>.pages.dev                                  # 🔴 実 host
  VITE_RP_NAME: dicekey Coffee Stamps
```

## Test Strategy

- [ ] CF Pages の build が成功（`build-kit.sh` が CF builder 環境で network 経由で OZ spec 取得できることを要確認）
- [ ] 公開 URL `https://dicekey-customer-app.pages.dev` でホーム到達
- [ ] パスキー新規作成（Touch ID / Windows Hello / Android）が完走
- [ ] スタンプ枚数 / Beans 残高が表示（read-only 動作確認）
- [ ] エッジケース: `build-kit.sh` が CF Pages の制約で失敗する場合、`.oz-build/` を pre-built tarball で配布する代替案 🔴
- [ ] エッジケース: 別端末から同時に新規作成 → どちらも成功（fee payer drain しないことを目視）。**ただし sequence 競合発生時は再試行で OK としドキュメントに記載**

## Implementation Notes

- 参照すべき既存コード:
  - `apps/customer-app/package.json` の build script
  - `scripts/build-kit.sh`（CF builder 環境で動くか要確認）
- 実装のヒント:
  - `pnpm-workspace.yaml` の `overrides` で `smart-account-kit-bindings: file:./.oz-build/...` 参照があるため、build 中に `.oz-build/` が存在する必要あり → `build-kit.sh` が前段で必須
  - `dist/` 内に `_headers` / `_redirects` ファイルで CSP / SPA fallback 設定 🟡
  - 初回 deploy 後、自動生成された host (`*.pages.dev`) を `VITE_RP_ID` に再設定 → 再 deploy
- 注意事項:
  - Phase 1 では fee payer 鍵がクライアントから推測可能なため、悪意ある利用者がいると drain される。**Testnet なので friendbot で再 fund 可能** だが、運用ノートに記載
  - **CF Pages の RP ID 制約**: customer-app と staff-app が別 sub-host なため別 RP。Task 007 と独立した passkey enroll が必要 🔴

## Files

- 変更: `apps/customer-app/package.json`（build script 確認）
- 新規（任意）: `apps/customer-app/public/_headers`, `apps/customer-app/public/_redirects`
- 新規（任意）: `wrangler.toml` (Pages 用、選択肢)
- テスト: 手動検証（複数端末 / 複数ブラウザで）
