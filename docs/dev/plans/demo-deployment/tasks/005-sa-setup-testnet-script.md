---
id: "005"
title: "scripts/sa-setup-testnet.mjs を新規追加 (HQ SA bootstrap on Testnet)"
status: done
priority: 2
dependencies: ["004"]
estimated_complexity: medium
---

# Task: scripts/sa-setup-testnet.mjs を新規追加 (HQ SA bootstrap on Testnet)

## Goal

Testnet 上で HQ SA + 3 staff rules + benefits rule + contracts initialize + wire + demo customer + 1 issue を完走させ、`.env.testnet` に HQ SA / rule IDs / customer SA を書き戻す。既存 `scripts/sa-setup.mjs`（localnet 用）は **温存**。

## Interfaces

```javascript
// scripts/sa-setup-testnet.mjs (新規)
// 既存 scripts/sa-setup.mjs の構造を踏襲。差分のみ示す。

const ENV_FILE = join(ROOT, ".env.testnet");                  // 🔵
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:5180/";  // 🔵

// 1. proxy spawn は削除 — kit が Testnet 公開 RPC を直接叩く           // 🔵

// 2. kit deterministic deployer を Testnet で fund
async function ensureKitDeployerFunded() {                    // 🟡 (Testnet 用に新規)
  const addr = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";
  const res = await fetch(`https://friendbot.stellar.org/?addr=${addr}`);
  // 既に fund 済みの場合 400 が返るが無視
}

// 3. tools/sa-harness が Testnet env を読むよう切替
//    案: tools/sa-harness/.env.testnet を生成（.env.testnet の対応 key を抽出）
//    + scripts/sa-setup-testnet.mjs が pnpm --filter sa-harness dev を spawn する前に
//    HARNESS_MODE=testnet 等を渡し、harness 側の vite.config が .env.testnet を読む  // 🟡

// 4. main フローは sa-setup.mjs と同じ:
//    - kit.createWallet (HQ root credential)
//    - addPasskey x3 (staff rules: visit-stamps, beans-token, reward-policy)
//    - addPasskey x1 (staff benefits rule)
//    - 5 contracts initialize(admin=HQ_SA)
//    - reward-policy.set_*_contract(...) で wire
//    - dummy customer createWallet
//    - 1 issue() で動作確認
//    - .env.testnet 全 keys に書き戻し

// 5. Testnet 用エラー対処
//    - pollTransaction (kit 内) のデフォルト attempt 数で足りない可能性 🔴
//      → 失敗時は Node 側で retry wrapper を作る
//    - friendbot rate limit (per address) → 5秒待って再試行
```

## Test Strategy

- [ ] 事前準備: Task 004 で `.env.testnet` が生成済みで HQ SA 系が空欄
- [ ] `pnpm --filter sa-harness dev` を Testnet env で起動（vite が .env.testnet を読む）
- [ ] `node scripts/sa-setup-testnet.mjs` 実行で:
  - [ ] kit deployer が friendbot fund される
  - [ ] HQ SA contract id が生成され `.env.testnet` 更新
  - [ ] 4 つの staff rule ids が生成される (3 + 1 benefits)
  - [ ] 5 contracts が initialize される
  - [ ] reward-policy が他 4 contracts に wire される
  - [ ] dummy customer SA が作成され issue() が成功
- [ ] エッジケース: 同じ contracts に対して再実行すると `already initialized` で停止 → Task 004 で `.env.testnet` 再生成が必要であることを明示
- [ ] エッジケース: friendbot rate limit (`429`) で fund 失敗 → 5 秒 retry x 3

## Implementation Notes

- 参照すべき既存コード:
  - `scripts/sa-setup.mjs`（localnet 版、ほぼコピー）
  - `tools/sa-harness/src/harness.ts`（kit 操作の集合）
  - CLAUDE.md「Gotchas」: one-shot pipeline、kit needs HTTPS RPC、CDP headless Chromium SIGSEGV
- 実装のヒント:
  - harness の env 切替は `tools/sa-harness/.env.testnet` を生成して `vite dev --mode testnet` 風に解決
  - friendbot 失敗時は status code を見て retry
  - Playwright + CDP virtual authenticator の SIGSEGV 対策で 1 度 retry
- 注意事項:
  - **localnet 版 `sa-setup.mjs` は絶対に壊さない**（CLAUDE.md 既存運用ルール）
  - 出力先 ENV_FILE のハードコードは Test 005 専用、共通化しない

## Files

- 新規: `scripts/sa-setup-testnet.mjs`
- 必要に応じて新規: `tools/sa-harness/.env.testnet`（or `tools/sa-harness/.env.testnet.template`）
- 変更（必要時）: `tools/sa-harness/vite.config.ts`（mode 別 env 読込み）
- テスト: 手動検証 + Testnet explorer で HQ SA contract 確認
