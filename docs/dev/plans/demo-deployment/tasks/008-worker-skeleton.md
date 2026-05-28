---
id: "008"
title: "Hono Worker のスケルトン + wrangler.toml"
status: done
priority: 4
dependencies: ["006", "007"]
estimated_complexity: medium
---

# Task: Hono Worker のスケルトン + wrangler.toml

## Goal

Cloudflare Workers 上で Hono を起動し、CORS + 環境変数読み込み + 空の `POST /relayer`（501 を返す）が動作する状態にする。Phase 1.5 の足回り。

## Interfaces

```typescript
// apps/worker/src/index.ts (新規 monorepo package)
import { Hono } from "hono";                          // 🔵
import { cors } from "hono/cors";                      // 🔵

type Env = {
  Bindings: {
    FEE_PAYER_SECRET: string;                          // 🔵 wrangler secret
    RPC_URL: string;                                   // 🔵 https://soroban-testnet.stellar.org
    NETWORK_PASSPHRASE: string;                        // 🔵 "Test SDF Network ; September 2015"
    ALLOWED_ORIGINS: string;                           // 🔵 csv: pages.dev hosts
    ALLOWED_CONTRACTS: string;                         // 🔵 csv: C addresses
    SEQUENCE_MANAGER: DurableObjectNamespace;          // 🔵 (Task 009)
  };
};

const app = new Hono<Env>();

app.use("*", cors({
  origin: (origin, c) => {
    const allowed = c.env.ALLOWED_ORIGINS.split(",").map(s => s.trim());
    return allowed.includes(origin) ? origin : "";    // 🔵
  },
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
}));

app.post("/relayer", async (c) => {
  return c.json({ success: false, error: "not implemented" }, 501);  // 🟡 (Task 010 で実装)
});

app.get("/health", (c) => c.text("ok"));              // 🔵

export default app;
```

```toml
# apps/worker/wrangler.toml (新規)
name = "dicekey-relayer"                              # 🔵
main = "src/index.ts"
compatibility_date = "2026-05-01"
node_compat = true                                    # 🟡 @stellar/stellar-sdk が node API を要求する可能性

[vars]
ALLOWED_ORIGINS = "https://dicekey-customer-app.pages.dev,https://dicekey-staff-app.pages.dev"
ALLOWED_CONTRACTS = ""                                # deploy 時に setupin
RPC_URL = "https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

[[durable_objects.bindings]]                          # 🔵 (Task 009)
name = "SEQUENCE_MANAGER"
class_name = "SequenceManager"
script_name = "dicekey-relayer"

[[migrations]]
tag = "v1"
new_classes = ["SequenceManager"]
```

```json
// apps/worker/package.json (新規)
{
  "name": "dicekey-relayer-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "secret": "wrangler secret put"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "wrangler": "^3.80.0",
    "typescript": "^5.8.0"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@stellar/stellar-sdk": "^15.0.0"
  }
}
```

## Test Strategy

- [ ] `pnpm --filter dicekey-relayer-worker dev` (wrangler dev) で 8787 等のポートで起動
- [ ] `curl http://localhost:8787/health` で `ok` を返す
- [ ] `curl -X OPTIONS http://localhost:8787/relayer -H "Origin: https://dicekey-customer-app.pages.dev"` で CORS preflight が 204 + 適切な Allow-Origin
- [ ] `curl -X OPTIONS ... -H "Origin: https://evil.example.com"` で Allow-Origin が付かない
- [ ] `curl -X POST http://localhost:8787/relayer` で 501 が返る
- [ ] エッジケース: wrangler のローカルで Durable Object stub が動く（次タスク 009 の前提）

## Implementation Notes

- 参照すべき既存コード:
  - `pnpm-workspace.yaml`（`apps/worker` を packages に追加）
  - 既存 `apps/customer-app/package.json` の構造
- 実装のヒント:
  - monorepo workspace に `apps/worker` を追加
  - `@stellar/stellar-sdk` は Workers の Node compat で動く想定。動かない場合 `compatibility_flags = ["nodejs_compat"]` 追加
  - 後段 (Task 011) で sdk が `VITE_WORKER_URL` を参照するので、ローカル開発時の URL を README に記載
- 注意事項:
  - `node_compat = true` は今後 deprecated になる可能性 → `compatibility_flags = ["nodejs_compat"]` を推奨

## Files

- 新規: `apps/worker/src/index.ts`, `apps/worker/wrangler.toml`, `apps/worker/package.json`, `apps/worker/tsconfig.json`
- 変更: `pnpm-workspace.yaml`（`apps/worker` を追加）
- テスト: `wrangler dev` ローカル + curl 動作確認
