---
id: "010"
title: "POST /relayer エンドポイント実装 (kit 公式 relayer protocol 準拠)"
status: done
priority: 4
dependencies: ["008", "009"]
estimated_complexity: high
---

# Task: POST /relayer エンドポイント実装 (kit 公式 relayer protocol 準拠)

## Goal

kit が `relayerUrl` 経由で送ってくる `{func, auth}` または `{xdr}` を受け、Worker 側で sourceAccount = fee payer の外側 tx を組み、submit して `{ success, hash }` を返す。kit の公式 protocol に厳密に従うことで sdk 側の改修を最小化する。

## Interfaces

```typescript
// apps/worker/src/relayer-handler.ts (新規)
import { Hono } from "hono";
import {
  Keypair, TransactionBuilder, Operation, Account, xdr,
  Networks,
} from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";

type RelayerSendRequest = { func: string; auth: string[] };  // 🔵
type RelayerSendXdrRequest = { xdr: string };                 // 🔵
type RelayerRequest = RelayerSendRequest | RelayerSendXdrRequest;

interface RelayerResponse {                                   // 🔵 kit が解釈する形式
  success: boolean;
  hash?: string;
  status?: "SUCCESS" | "FAILED" | "PENDING";
  transactionId?: string;
  error?: string;
  errorCode?:
    | "INVALID_PARAMS" | "INVALID_XDR" | "POOL_CAPACITY"
    | "SIMULATION_FAILED" | "ONCHAIN_FAILED"
    | "INVALID_TIME_BOUNDS" | "FEE_LIMIT_EXCEEDED"
    | "UNAUTHORIZED";
}

// ───────── route ─────────
app.post("/relayer", async (c) => {
  const body = await c.req.json<RelayerRequest>();           // 🔵
  if ("xdr" in body)
    return handleXdr(c, body.xdr);
  if ("func" in body && "auth" in body)
    return handleFuncAuth(c, body.func, body.auth);
  return c.json<RelayerResponse>(
    { success: false, errorCode: "INVALID_PARAMS" }, 400);
});

// ───────── handlers ─────────
async function handleFuncAuth(c, funcB64: string, authB64s: string[]) {
  // 1. parse + validate target contract                     // 🟡
  const func = xdr.HostFunction.fromXDR(funcB64, "base64");
  const target = extractInvokeContractId(func);              // helper
  const allowed = c.env.ALLOWED_CONTRACTS.split(",");
  if (target && !allowed.includes(target)) {
    return c.json<RelayerResponse>(
      { success: false, errorCode: "UNAUTHORIZED",
        error: `target ${target} not in allowlist` }, 403);
  }

  // 2. fee payer setup                                       // 🔵
  const kp = Keypair.fromSecret(c.env.FEE_PAYER_SECRET);
  const rpc = new RpcServer(c.env.RPC_URL);

  // 3. next seq from DO                                      // 🔵
  const id = c.env.SEQUENCE_MANAGER.idFromName("default");
  const stub = c.env.SEQUENCE_MANAGER.get(id);
  const seqRes = await stub.fetch("https://do/next", { method: "POST" });
  const { seq } = await seqRes.json<{ seq: string }>();

  // 4. build outer tx                                        // 🔵
  const account = new Account(kp.publicKey(), seq);
  const tx = new TransactionBuilder(account, {
    fee: "10000000",                                          // 🟡 base fee 多めに
    networkPassphrase: c.env.NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({
      func,
      auth: authB64s.map(a =>
        xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
    }))
    .setTimeout(300)
    .build();

  // 5. simulate + prepare (resource fee 確定)                 // 🔵
  let prepared;
  try {
    prepared = await rpc.prepareTransaction(tx);
  } catch (e) {
    await stub.fetch("https://do/rollback", { method: "POST" });
    return c.json<RelayerResponse>(
      { success: false, errorCode: "SIMULATION_FAILED",
        error: String(e) }, 502);
  }
  prepared.sign(kp);                                          // 🔵

  // 6. submit + poll                                          // 🔵
  const send = await rpc.sendTransaction(prepared);
  if (send.status === "ERROR") {
    await stub.fetch("https://do/rollback", { method: "POST" });
    return c.json<RelayerResponse>(
      { success: false, errorCode: "ONCHAIN_FAILED",
        error: send.errorResult?.toXDR("base64") }, 502);
  }
  const result = await rpc.pollTransaction(send.hash, { attempts: 15 }); // 🟡
  if (result.status !== "SUCCESS") {
    return c.json<RelayerResponse>(
      { success: false, hash: send.hash, errorCode: "ONCHAIN_FAILED",
        error: result.status }, 502);
  }

  return c.json<RelayerResponse>(
    { success: true, hash: send.hash, status: "SUCCESS" });
}

async function handleXdr(c, xdrB64: string) {                 // 🟡 deployment fee-bump 経路
  let inner;
  try {
    inner = TransactionBuilder.fromXDR(xdrB64, c.env.NETWORK_PASSPHRASE);
  } catch (e) {
    return c.json<RelayerResponse>(
      { success: false, errorCode: "INVALID_XDR" }, 400);
  }
  const kp = Keypair.fromSecret(c.env.FEE_PAYER_SECRET);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    kp, "20000000", inner, c.env.NETWORK_PASSPHRASE);          // 🟡 fee bump
  feeBump.sign(kp);

  const rpc = new RpcServer(c.env.RPC_URL);
  const send = await rpc.sendTransaction(feeBump);
  // ... pollTransaction → response (handleFuncAuth と同形)
}

// helper
function extractInvokeContractId(func: xdr.HostFunction): string | null {
  if (func.switch().value === xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) {
    const addr = func.invokeContract().contractAddress();
    return addr.contractId().toXDR("hex");                    // 🟡 → C address に変換するなら StrKey
  }
  return null;
}
```

## Test Strategy

- [ ] customer-app の `createWallet` を kit + relayerUrl 経由で実行 → Worker の xdr 経路で deploy 成功
- [ ] staff-app の issue() を kit + relayerUrl 経由で実行 → func/auth 経路で成功（HQ SA の 3 context rules を含む）
- [ ] 並列 10 リクエストで sequence 競合無し（DO + handleFuncAuth の合成テスト）
- [ ] ALLOWED_CONTRACTS 外の contract id を含む func を投げると 403 UNAUTHORIZED
- [ ] simulate 失敗 → 502 SIMULATION_FAILED + rollback 発火
- [ ] エッジケース: kit が relayer 経路で送る func が **prepared か raw か** を実機で確認 🔴
  - prepared なら `prepareTransaction` 二重で OK か検証
  - raw なら必ず prepare 必要
- [ ] エッジケース: pollTransaction 15 attempts でも PENDING のまま → PENDING を返す（kit 側で再ポーリング可能か確認 🔴）

## Implementation Notes

- 参照すべき既存コード:
  - `.oz-build/smart-account-kit/src/relayer.ts:197-330`（kit が送る/受ける形式の原典）
  - `.oz-build/smart-account-kit/src/tx-ops.ts:62-109`（relayer/rpc の自動経路選択）
  - `@stellar/stellar-sdk` の `TransactionBuilder.buildFeeBumpTransaction`, `rpc.prepareTransaction`
- 実装のヒント:
  - errorCode は kit 内部で string match されるため、表記揺れ厳禁
  - polling の `attempts` を多めに（Testnet は 5-10 秒待ち）
  - fee 値はざっくり 1 XLM (= 10000000 stroops) からスタート、不足なら bump
- 注意事項:
  - **重要**: kit が prepared/raw のどちらを送るかは relayer.ts のソースを再確認すること（Task 010 実装前のスパイク）
  - `extractInvokeContractId` は `xdr.HostFunctionType` の判定が SDK バージョンで違う可能性 → 動作確認必須

## Files

- 新規: `apps/worker/src/relayer-handler.ts`, `apps/worker/src/xdr-helpers.ts`
- 変更: `apps/worker/src/index.ts`（route 接続）
- テスト: ローカル wrangler dev + curl で xdr/func 経路両方
