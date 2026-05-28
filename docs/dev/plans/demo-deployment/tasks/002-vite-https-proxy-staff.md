---
id: "002"
title: "staff-app に Vite HTTPS + /rpc proxy を追加"
status: done
priority: 1
dependencies: ["001"]
estimated_complexity: low
---

# Task: staff-app に Vite HTTPS + /rpc proxy を追加

## Goal

staff-app も同じ Vite proxy 構成にして、`pnpm --filter staff-app dev` 1 本で HQ root credential 認証 → 来店スタンプ発行 (U2 case C) が動作する状態にする。

## Interfaces

```typescript
// apps/staff-app/vite.config.ts (新規、001 と同一内容)
import { defineConfig } from "vite";                  // 🔵
import react from "@vitejs/plugin-react";              // 🔵
import basicSsl from "@vitejs/plugin-basic-ssl";       // 🔵

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
    proxy: {
      "/rpc": {
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
      "/friendbot": {
        target: "http://stellar-localnet:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

```bash
# apps/staff-app/.env
VITE_RPC_URL=https://localhost:5174/rpc               # 🔵 staff-app の port = 5174
```

## Test Strategy

- [ ] `pnpm --filter staff-app dev` 単独で 5174 が `https` 起動
- [ ] HQ root credential で staff sign-in が完走（事前に localnet で `sa-setup.mjs` 実行済みであること）
- [ ] staff passkey で来店スタンプ発行 (issue) が成功（customer の C-address に stamp 1, beans +10）
- [ ] エッジケース: `scripts/rpc-https-proxy.mjs` 未起動でも動作

## Implementation Notes

- 参照すべき既存コード: Task 001 完了後の `apps/customer-app/vite.config.ts`
- 実装のヒント:
  - 001 の vite.config.ts をコピー（port 番号は Vite が自動で 5174 を使う）
  - `pnpm --filter staff-app add -D @vitejs/plugin-basic-ssl`
- 注意事項:
  - staff-app の `.env` には HQ SA / staff rule ids も入っている。それらは触らない

## Files

- 新規/置換: `apps/staff-app/vite.config.ts`
- 変更: `apps/staff-app/.env`, `apps/staff-app/package.json`
- テスト: 手動検証
