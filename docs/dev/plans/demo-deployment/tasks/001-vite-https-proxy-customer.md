---
id: "001"
title: "customer-app に Vite HTTPS + /rpc proxy を追加"
status: done
priority: 1
dependencies: []
estimated_complexity: low
---

# Task: customer-app に Vite HTTPS + /rpc proxy を追加

## Goal

customer-app の Vite dev サーバ自体に HTTPS（自己署名）と `/rpc` proxy を持たせ、ホスト Chrome から `pnpm --filter customer-app dev` 1 本で passkey 新規作成が完走する状態にする（Network Error バグ解消）。`scripts/rpc-https-proxy.mjs` の起動も `devcontainer.json` の port 8443 forward も不要にする。

## Interfaces

```typescript
// apps/customer-app/vite.config.ts (新規)
import { defineConfig } from "vite";                  // 🔵
import react from "@vitejs/plugin-react";              // 🔵
import basicSsl from "@vitejs/plugin-basic-ssl";       // 🔵 新規依存

export default defineConfig({
  plugins: [react(), basicSsl()],                      // 🔵
  server: {
    https: true,                                       // 🔵
    proxy: {
      "/rpc": {                                        // 🔵
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
      "/friendbot": {                                  // 🟡 予防的、localnet のみ意味あり
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

```bash
# apps/customer-app/.env
VITE_RPC_URL=https://localhost:5173/rpc                # 🔵 absolute URL 必須 (kit.ts:355,361,363 で検証)
# 旧 VITE_RPC_PROXY_URL=https://127.0.0.1:8443/rpc は削除（または .env.test に分離 → Task 003）
```

## Test Strategy

- [ ] `pnpm --filter customer-app dev` 単独で 5173 が `https` 起動する（コンソールに `https://localhost:5173/` の URL が出る）
- [ ] ホスト Chrome で `https://localhost:5173` を開き、自己署名警告を「詳細→続行」した後に React アプリがマウントされる
- [ ] DevTools Network タブで `POST https://localhost:5173/rpc` が 200 を返す（kit の `getLedgerEntries` 等）
- [ ] LoginPage → 「新規作成」ボタン → Touch ID/WebAuthn → ホーム画面到達まで完走（手動）
- [ ] エッジケース: 別ターミナルで `scripts/rpc-https-proxy.mjs` を **起動しない** 状態でも上記が成立すること
- [ ] HMR (Hot Module Replacement) が https 化後も機能する（src のファイル編集で再ロードされる）

## Implementation Notes

- 参照すべき既存コード:
  - `.dcs/20260522084831_passkey_signup_network_err/final_report.md` § 3.2「推奨される修正方法」
  - 既存 `apps/customer-app/vite.config.ts`（あれば置換、無ければ新規）
  - `apps/customer-app/.env` の `VITE_RPC_URL` の現状値
- 実装のヒント:
  - `pnpm --filter customer-app add -D @vitejs/plugin-basic-ssl`
  - basicSsl が `.cert/` 等に証明書を生成する。`.gitignore` で除外されることを確認
  - HMR が https 化で接続失敗する場合 `server.hmr.protocol = "wss"` を追加 🟡
- 注意事項:
  - 既存 `scripts/rpc-https-proxy.mjs` は **削除しない**（E2E / smoke / sa-setup が依存）
  - `tools/sa-harness/` の env は触らない（harness は別 port、別 env で動作）

## Files

- 新規/置換: `apps/customer-app/vite.config.ts`
- 変更: `apps/customer-app/.env`, `apps/customer-app/package.json`（devDependencies 追加）
- テスト: 手動検証のみ（既存 E2E は Task 003 で影響範囲確認）
