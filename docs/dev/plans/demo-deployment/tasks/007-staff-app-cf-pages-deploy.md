---
id: "007"
title: "staff-app を Cloudflare Pages にデプロイ"
status: done
priority: 3
dependencies: ["002", "004", "005", "006"]
estimated_complexity: medium
---

# Task: staff-app を Cloudflare Pages にデプロイ

## Goal

staff-app を別 `*.pages.dev` host で公開し、HQ root credential 認証 → 来店スタンプ発行 (U2 case C) が動作する状態にする。

## Interfaces

```yaml
# Cloudflare Pages dashboard 設定
project_name: dicekey-staff-app                                   # 🔵
production_branch: main
build_command: |
  pnpm install --frozen-lockfile && \
  bash scripts/build-kit.sh && \
  pnpm --filter @dicekey/sdk build && \
  pnpm --filter @dicekey/contracts build && \
  pnpm --filter staff-app build
build_output_directory: apps/staff-app/dist

env vars (production):                                            # 🔵 .env.testnet と同期
  # ... customer-app と同じ contracts/passphrase 系
  VITE_RP_ID: dicekey-staff-app.pages.dev                          # 🔴 staff-app 専用 host
  VITE_RP_NAME: dicekey Coffee Stamps (Staff)
```

## Test Strategy

- [ ] CF Pages build 成功
- [ ] staff sign-in（HQ root credential）が完走 — **staff-app 用 RP ID で別途 enroll した credential** を使う
- [ ] customer-app で作った customer SA に対して来店スタンプ発行が成功
- [ ] Use Beans / Receive Benefit のフロー成功（要 sa-setup-testnet 完了済み、CLAUDE.md 既知の TODO 範囲内）
- [ ] エッジケース: customer-app の RP credential を staff-app で使おうとすると WebAuthn が拒否すること（仕様確認）

## Implementation Notes

- 参照すべき既存コード:
  - `apps/staff-app/package.json` の build script
  - Task 006 の設定（ほぼコピー、project_name と RP ID のみ差し替え）
- 実装のヒント:
  - **RP ID の制約**: staff-app は customer-app と異なる sub-host → 別 RP。HQ SA の signer は staff-app 用に **別途 enroll** する必要あり
  - HQ SA に対し複数 RP の signer を addPasskey できるかは kit の挙動次第（複数 CallContext rule + 異なる WebAuthn signer なら OK のはず）→ 検証して運用手順を README 化
- 注意事項:
  - Worker 化 (Phase 1.5) 完了までは fee payer drain リスクあり（Phase 1 受容）
  - staff-app の Use Beans / Receive Benefit は TODO 範囲（CLAUDE.md 記載）

## Files

- 変更: `apps/staff-app/package.json`（必要時）
- 新規（任意）: `apps/staff-app/public/_headers`, `apps/staff-app/public/_redirects`
- テスト: 手動検証 + customer-app との連携確認
