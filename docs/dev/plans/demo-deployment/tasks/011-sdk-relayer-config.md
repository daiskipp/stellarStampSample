---
id: "011"
title: "packages/sdk に relayerUrl 設定を追加"
status: done
priority: 5
dependencies: ["010"]
estimated_complexity: low
---

# Task: packages/sdk に relayerUrl 設定を追加

## Goal

customer-app / staff-app の build 時に `VITE_WORKER_URL` を env で受け取り、kit を `relayerUrl` 付きで初期化する。これにより kit が自動的に submit を Worker 経由にする。**`signAndSubmitTx` 本体は無改修**（kit が経路選択を自動化しているため）。

## Interfaces

```typescript
// packages/sdk/src/config.ts (改修)
export interface NetworkConfig {
  rpcUrl: string;                                        // 🔵 既存
  networkPassphrase: string;                             // 🔵 既存
  contracts: {                                            // 🔵 既存
    visitStamps: string;
    beansToken: string;
    benefits: string;
    badges: string;
    rewardPolicy: string;
  };
  smartAccount: SmartAccountEnv;                          // 🔵 既存
  relayerUrl?: string;                                    // 🔵 NEW (optional)
}

// TESTNET_CONFIG (env 構築箇所)
export function getTestnetConfig(env: ImportMetaEnv): NetworkConfig {
  return {
    rpcUrl: env.VITE_RPC_URL,
    networkPassphrase: env.VITE_NETWORK_PASSPHRASE,
    contracts: { ... },
    smartAccount: { ... },
    relayerUrl: env.VITE_WORKER_URL || undefined,         // 🔵 NEW
  };
}

// packages/sdk/src/smart-account.ts (改修)
export function createKit(opts: CreateKitOptions = {}): SmartAccountKit {
  const cfg = getConfig();
  return new SmartAccountKit({
    rpcUrl: cfg.rpcUrl,                                   // 🔵 既存
    networkPassphrase: cfg.networkPassphrase,
    accountWasmHash: cfg.smartAccount.accountWasmHash,
    webauthnVerifierAddress: cfg.smartAccount.webauthnVerifierAddress,
    rpId: opts.rpIdOverride ?? cfg.smartAccount.rpId,
    rpName: cfg.smartAccount.rpName,
    indexerUrl: false,
    storage: opts.storage ?? new IndexedDBStorage(),
    relayerUrl: cfg.relayerUrl,                           // 🔵 NEW
  });
}

// signAndSubmitTx は無改修                                // 🔵
// kit が tx-ops.ts:62 で relayer/rpc を自動選択する
```

```bash
# apps/customer-app/.env.production (CF Pages で env 注入される値の論理的記述)
VITE_WORKER_URL=https://dicekey-relayer.<account>.workers.dev/relayer
# 末尾の /relayer まで含めるか、Worker URL ベースだけにするかは kit の relayer.ts 仕様による
# → Task 010 のテスト時に kit が自動で /relayer を付けるかを確認 🔴
```

## Test Strategy

- [ ] `VITE_WORKER_URL` 未設定 (= localnet dev) で `createKit()` の internal relayer が null → 従来通り rpc 直接（既存 localnet が壊れない）
- [ ] `VITE_WORKER_URL` 設定時、`createKit().relayer` が non-null
- [ ] customer-app から `createWallet` 実行時、DevTools Network で `https://*.workers.dev/relayer` への POST が観測される
- [ ] レスポンスの `{ success: true, hash }` が kit に返り、`kit.signAndSubmit` の戻り値に hash が含まれる
- [ ] エッジケース: Worker が 502 を返した時、UI に意味のあるエラーが表示される（既存 LoginPage の "Network Error" 改善を含めると別タスクだが、最低限 console エラーは識別可能に）

## Implementation Notes

- 参照すべき既存コード:
  - `packages/sdk/src/config.ts`（getTestnetConfig / getLocalnetConfig の構造）
  - `packages/sdk/src/smart-account.ts` の `createKit` 関数
  - `.oz-build/smart-account-kit/src/kit.ts` の `relayerUrl` パラメータ箇所
- 実装のヒント:
  - `signAndSubmitTx` は手を入れない（kit 内部の `getSubmissionMethod` が relayer を見て自動切替）
  - `apps/customer-app/.env.production` / `.env.testnet` のどちらに置くかは Vite mode 設計次第 🟡
- 注意事項:
  - **kit の relayer URL 末尾の扱い** が `/relayer` を含むか含まないかを Task 010 の検証で確定する 🔴

## Files

- 変更: `packages/sdk/src/config.ts`, `packages/sdk/src/smart-account.ts`
- 変更: `apps/customer-app/.env.testnet`（or `.env.production`）, `apps/staff-app/.env.testnet`
- テスト: 既存 localnet E2E がパス + CF Pages preview deploy で動作確認
