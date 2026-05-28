---
id: "009"
title: "SequenceManager Durable Object を実装"
status: done
priority: 4
dependencies: ["008"]
estimated_complexity: high
---

# Task: SequenceManager Durable Object を実装

## Goal

fee payer account の sequence number を Worker 内で **race-free に直列化** し、複数同時 submit でも `tx_bad_seq` が発生しない状態にする。DO の single-threaded event loop で並行アクセスを直列化。

## Interfaces

```typescript
// apps/worker/src/sequence-manager.ts (新規)
import { Server as RpcServer, Keypair } from "@stellar/stellar-sdk/rpc";

export interface SequenceState {
  lastSeq: string | null;     // BigInt as string (DO storage は JSON のみ)
  syncedAt: number;           // ms epoch
}

export class SequenceManager implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private rpc: RpcServer;
  private feePayer: string;
  private cache: SequenceState = { lastSeq: null, syncedAt: 0 };

  constructor(state: DurableObjectState, env: Env) {       // 🔵
    this.state = state;
    this.env = env;
    this.rpc = new RpcServer(env.RPC_URL);
    this.feePayer = Keypair.fromSecret(env.FEE_PAYER_SECRET).publicKey();
  }

  async fetch(req: Request): Promise<Response> {           // 🔵
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/next":     return this.handleNext();
      case "/refresh":  return this.handleRefresh();
      case "/rollback": return this.handleRollback();
      default:          return new Response("not found", { status: 404 });
    }
  }

  // ── private ────────────────────────────────
  private async loadCache(): Promise<void> {                // 🔵
    const stored = await this.state.storage.get<SequenceState>("state");
    if (stored) this.cache = stored;
  }

  private async saveCache(): Promise<void> {                // 🔵
    await this.state.storage.put("state", this.cache);
  }

  private async syncFromRpc(): Promise<bigint> {            // 🔵
    const acc = await this.rpc.getAccount(this.feePayer);
    const seq = BigInt(acc.sequenceNumber());
    this.cache = { lastSeq: seq.toString(), syncedAt: Date.now() };
    await this.saveCache();
    return seq;
  }

  private async handleNext(): Promise<Response> {           // 🔵
    if (!this.cache.lastSeq) await this.loadCache();
    let cur: bigint;
    if (this.cache.lastSeq === null) {
      cur = await this.syncFromRpc();
    } else {
      cur = BigInt(this.cache.lastSeq);
    }
    const next = cur + 1n;
    this.cache = { lastSeq: next.toString(), syncedAt: Date.now() };
    await this.saveCache();
    return Response.json({ seq: next.toString() });
  }

  private async handleRefresh(): Promise<Response> {        // 🔵
    const seq = await this.syncFromRpc();
    return Response.json({ seq: seq.toString() });
  }

  private async handleRollback(): Promise<Response> {       // 🟡 (best-effort)
    if (!this.cache.lastSeq) return Response.json({ ok: true });
    const cur = BigInt(this.cache.lastSeq);
    this.cache = { lastSeq: (cur - 1n).toString(), syncedAt: Date.now() };
    await this.saveCache();
    return Response.json({ ok: true });
  }
}
```

## Test Strategy

- [ ] `wrangler dev` 上で `curl -X POST .../relayer` を 100 並列 → DO 内の seq が **strictly increasing** で重複なし
- [ ] 初回起動時、`/next` の最初の呼び出しが自動的に RPC から sync する
- [ ] `/refresh` が rpc から sequence を再取得して上書きする
- [ ] エッジケース: DO restart（Worker redeploy 等）で in-memory cache が消えても storage から復元
- [ ] エッジケース: `/rollback` を 1 回呼ぶと次の `/next` の値が rollback 前の値と同じ
- [ ] エッジケース: stale cache（synced > 5 分前 + bad_seq 経験）で auto-refresh する経路を持つ（Task 010 のリトライ経路と連動）

## Implementation Notes

- 参照すべき既存コード:
  - `@stellar/stellar-sdk` の `rpc.Server.getAccount(...)` API
  - Cloudflare Durable Objects docs (single-threaded fetch handler)
- 実装のヒント:
  - DO の RPC は `fetch` over `idFromName("default")` の stub.fetch を使う（Task 010 から呼ぶ）
  - `state.storage.put/get` の I/O は最小に（毎 next で put しているが volume 少なければ OK、issue 過剰なら memory only + 定期 flush）
  - `BigInt` を JSON 経由でやり取りするので必ず string 変換
- 注意事項:
  - DO は無料枠 5000 万 req/月（CF 2024 時点）。同時実行は単一 instance に集約させるため `idFromName("default")` を使う

## Files

- 新規: `apps/worker/src/sequence-manager.ts`
- 変更: `apps/worker/src/index.ts`（DO を export）, `apps/worker/wrangler.toml`（migrations は Task 008 で済み）
- テスト: 並列 curl + ローカル wrangler dev
