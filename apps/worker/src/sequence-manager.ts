import { Keypair, rpc } from "@stellar/stellar-sdk";

export interface SequenceState {
  lastSeq: string | null;
  syncedAt: number;
}

type Env = {
  RPC_URL: string;
  FEE_PAYER_SECRET: string;
};

// 🟡 Intent: minimal RPC surface SequenceManager needs. Lets tests inject a
//    fast in-memory stub instead of pulling in @stellar/stellar-sdk + network.
export interface RpcLike {
  getAccount(publicKey: string): Promise<{ sequenceNumber(): string }>;
}

const STORAGE_KEY = "state";

// 🔵 Intent: Task 009 spec — fee payer sequence is serialized inside a single
//    DO instance (Worker requests are funneled to `idFromName("default")`),
//    so the DO event loop guarantees /next never hands out the same number
//    twice. State is mirrored to DO storage so an evict/redeploy resumes
//    instead of re-syncing past the in-flight tx.
export class SequenceManager implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly rpc: RpcLike;
  private readonly feePayer: string;
  private cache: SequenceState = { lastSeq: null, syncedAt: 0 };
  private loaded = false;

  // 🔵 Intent: spec signature is `(state, env)`. The third `opts` argument is
  //    test-only DI for the RPC client and fee-payer pubkey; CF Workers always
  //    invokes the 2-arg form so production behavior is unchanged.
  constructor(
    state: DurableObjectState,
    env: Env,
    opts?: { rpc?: RpcLike; feePayer?: string },
  ) {
    this.state = state;
    this.rpc = opts?.rpc ?? new rpc.Server(env.RPC_URL);
    this.feePayer =
      opts?.feePayer ?? Keypair.fromSecret(env.FEE_PAYER_SECRET).publicKey();
  }

  // 🔵 Intent: DO request router. Internal-only — called by the Worker via
  //    `env.SEQUENCE_MANAGER.get(id).fetch(...)` (Task 010).
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/next":
        return this.handleNext();
      case "/refresh":
        return this.handleRefresh();
      case "/rollback":
        return this.handleRollback();
      default:
        return new Response("not found", { status: 404 });
    }
  }

  private async loadCache(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<SequenceState>(STORAGE_KEY);
    if (stored) this.cache = stored;
    this.loaded = true;
  }

  private async saveCache(): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, this.cache);
  }

  private async syncFromRpc(): Promise<bigint> {
    const acc = await this.rpc.getAccount(this.feePayer);
    const seq = BigInt(acc.sequenceNumber());
    this.cache = { lastSeq: seq.toString(), syncedAt: Date.now() };
    await this.saveCache();
    return seq;
  }

  private async handleNext(): Promise<Response> {
    await this.loadCache();
    const cur =
      this.cache.lastSeq === null
        ? await this.syncFromRpc()
        : BigInt(this.cache.lastSeq);
    const next = cur + 1n;
    this.cache = { lastSeq: next.toString(), syncedAt: Date.now() };
    await this.saveCache();
    return Response.json({ seq: next.toString() });
  }

  private async handleRefresh(): Promise<Response> {
    const seq = await this.syncFromRpc();
    this.loaded = true;
    return Response.json({ seq: seq.toString() });
  }

  // 🟡 Intent: best-effort rollback for Task 010's tx-failure recovery.
  //    Decrements the in-memory + persisted cursor by one. Safe because the
  //    DO event loop serializes /next and /rollback — no two callers can
  //    interleave a half-decremented value.
  private async handleRollback(): Promise<Response> {
    await this.loadCache();
    if (this.cache.lastSeq !== null) {
      const cur = BigInt(this.cache.lastSeq);
      this.cache = { lastSeq: (cur - 1n).toString(), syncedAt: Date.now() };
      await this.saveCache();
    }
    return Response.json({ ok: true });
  }
}
