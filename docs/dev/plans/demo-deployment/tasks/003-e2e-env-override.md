---
id: "003"
title: "E2E / smoke / sa-setup で旧 :8443 経路を env override で温存"
status: done
priority: 1
dependencies: ["001", "002"]
estimated_complexity: low
---

# Task: E2E / smoke / sa-setup で旧 :8443 経路を env override で温存

## Goal

Task 001/002 で `apps/*/.env` の `VITE_RPC_URL` が `https://localhost:5173(5174)/rpc` に変わるため、Playwright (`e2e/`) と `scripts/rpc-https-proxy.mjs` を経由する harness/smoke/sa-setup の既存自動テストが壊れないように、子プロセス起動時に旧 URL を env override で渡す。

## Interfaces

```typescript
// 案 A: env を子プロセスに注入する（最小工数）
// e2e/global-setup.ts, scripts/sa-setup.mjs, scripts/smoke-customer-app.mjs, smoke-staff-app.mjs
const child = spawn(viteBin, ["--mode", "test"], {
  env: {
    ...process.env,
    VITE_RPC_URL: "https://127.0.0.1:8443/rpc",         // 🔵
  },
});

// 案 B: apps/customer-app/.env.test と apps/staff-app/.env.test を別途用意
// → Vite が --mode test で読み込む。明示的で推奨 🟡
```

```bash
# 案 B 採用時:
# apps/customer-app/.env.test
VITE_RPC_URL=https://127.0.0.1:8443/rpc
# (他は .env から継承)
```

## Test Strategy

- [ ] `pnpm test:e2e` が全パス（既存 spec が壊れない）
- [ ] `node scripts/sa-setup.mjs` が完走（HQ SA 作成 → issue まで）
- [ ] `node scripts/smoke-customer-app.mjs` が完走
- [ ] `node scripts/smoke-staff-app.mjs` が完走
- [ ] エッジケース: ホスト Chrome での `pnpm dev` (production .env) は 001/002 の挙動を維持

## Implementation Notes

- 参照すべき既存コード:
  - `e2e/global-setup.ts`（proxy spawn の箇所）
  - `scripts/sa-setup.mjs`（Vite spawn の箇所、HARNESS_URL 周辺）
  - `scripts/smoke-customer-app.mjs`, `smoke-staff-app.mjs`
- 実装のヒント:
  - 案 B（`.env.test`）の方が明示的で後から読み解きやすい
  - `vite dev --mode test` で `.env.test` が `.env` を上書き
  - 既存 spec の `playwright.config.ts` の `webServer` 設定で `--mode test` を指定
- 注意事項:
  - `.env.test` は `.gitignore` 除外対象に含めるか検討（既存 `.env` の扱いと統一）

## Files

- 新規 (案 B): `apps/customer-app/.env.test`, `apps/staff-app/.env.test`
- 変更: `playwright.config.ts`（webServer の `--mode test` 追加）
- 変更（案 A 採用時）: `e2e/global-setup.ts`, `scripts/sa-setup.mjs`, `scripts/smoke-*.mjs`
- テスト: 既存 `pnpm test:e2e` が回帰として機能
