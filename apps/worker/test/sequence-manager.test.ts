import { test } from "node:test";
import assert from "node:assert/strict";
import { SequenceManager } from "../src/sequence-manager.ts";

// In-memory mock of the DurableObjectStorage surface the DO uses (.get/.put).
function makeStorage(initial?: Map<string, unknown>) {
  const map = initial ?? new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
  };
}

function makeState(storage: ReturnType<typeof makeStorage>) {
  return { storage } as unknown as DurableObjectState;
}

function makeRpc(initialSeq: bigint) {
  let current = initialSeq;
  let calls = 0;
  return {
    getCalls: () => calls,
    setSeq: (n: bigint) => {
      current = n;
    },
    async getAccount(_pk: string) {
      calls += 1;
      const cur = current;
      return {
        sequenceNumber(): string {
          return cur.toString();
        },
      };
    },
  };
}

const env = {
  RPC_URL: "https://soroban-testnet.stellar.org",
  FEE_PAYER_SECRET: "",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  ALLOWED_ORIGINS: "",
  ALLOWED_CONTRACTS: "",
  SEQUENCE_MANAGER: undefined as unknown as DurableObjectNamespace,
};

const FEE_PAYER = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";

function newDo(rpc: ReturnType<typeof makeRpc>, storage = makeStorage()) {
  return {
    storage,
    sm: new SequenceManager(makeState(storage), env, {
      rpc,
      feePayer: FEE_PAYER,
    }),
  };
}

test("/next on a fresh DO syncs from RPC and returns RPC_seq + 1", async () => {
  const rpc = makeRpc(100n);
  const { sm } = newDo(rpc);

  const res = await sm.fetch(new Request("http://do/next"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { seq: string };
  assert.equal(body.seq, "101");
  assert.equal(rpc.getCalls(), 1);
});

test("consecutive /next calls are strictly increasing and do not re-sync RPC", async () => {
  const rpc = makeRpc(1000n);
  const { sm } = newDo(rpc);

  const seqs: bigint[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await sm.fetch(new Request("http://do/next"));
    const body = (await res.json()) as { seq: string };
    seqs.push(BigInt(body.seq));
  }

  for (let i = 1; i < seqs.length; i++) {
    assert.equal(seqs[i], seqs[i - 1] + 1n, `seq[${i}] = ${seqs[i]}`);
  }
  assert.equal(seqs[0], 1001n);
  assert.equal(rpc.getCalls(), 1, "RPC must only be called once on first /next");
});

test("/refresh re-syncs from RPC and overwrites cache", async () => {
  const rpc = makeRpc(50n);
  const { sm } = newDo(rpc);

  await sm.fetch(new Request("http://do/next")); // primes cache to 51
  rpc.setSeq(500n); // RPC moved on (out-of-band fee-payer use)

  const refresh = await sm.fetch(new Request("http://do/refresh"));
  const refreshBody = (await refresh.json()) as { seq: string };
  assert.equal(refreshBody.seq, "500");

  const next = await sm.fetch(new Request("http://do/next"));
  const nextBody = (await next.json()) as { seq: string };
  assert.equal(nextBody.seq, "501", "next after refresh must continue from RPC seq");
});

test("DO restart resumes from storage without re-syncing RPC", async () => {
  const rpc1 = makeRpc(10n);
  const { storage } = newDo(rpc1);
  const sm1 = new SequenceManager(makeState(storage), env, {
    rpc: rpc1,
    feePayer: FEE_PAYER,
  });
  await sm1.fetch(new Request("http://do/next")); // 11
  await sm1.fetch(new Request("http://do/next")); // 12
  assert.equal(rpc1.getCalls(), 1);

  // Simulate DO eviction: new instance, same storage, fresh RPC stub.
  const rpc2 = makeRpc(99999n);
  const sm2 = new SequenceManager(makeState(storage), env, {
    rpc: rpc2,
    feePayer: FEE_PAYER,
  });

  const res = await sm2.fetch(new Request("http://do/next"));
  const body = (await res.json()) as { seq: string };
  assert.equal(body.seq, "13", "must resume from stored cache, not re-sync RPC");
  assert.equal(rpc2.getCalls(), 0, "restart must not hit RPC when storage has state");
});

test("/rollback decrements cache; next /next returns same value as last /next", async () => {
  const rpc = makeRpc(200n);
  const { sm } = newDo(rpc);

  const a = (await (await sm.fetch(new Request("http://do/next"))).json()) as {
    seq: string;
  };
  assert.equal(a.seq, "201");

  const rb = await sm.fetch(new Request("http://do/rollback"));
  assert.equal(rb.status, 200);
  const rbBody = (await rb.json()) as { ok: boolean };
  assert.equal(rbBody.ok, true);

  const b = (await (await sm.fetch(new Request("http://do/next"))).json()) as {
    seq: string;
  };
  assert.equal(b.seq, "201", "rollback then next must re-issue the same seq");
});

test("/rollback before any /next is a no-op", async () => {
  const rpc = makeRpc(7n);
  const { sm } = newDo(rpc);

  const res = await sm.fetch(new Request("http://do/rollback"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
  assert.equal(rpc.getCalls(), 0, "rollback must not trigger an RPC sync");
});

test("unknown path returns 404", async () => {
  const rpc = makeRpc(0n);
  const { sm } = newDo(rpc);

  const res = await sm.fetch(new Request("http://do/unknown"));
  assert.equal(res.status, 404);
});

test("storage persists after each /next (DO survives crash mid-batch)", async () => {
  const rpc = makeRpc(42n);
  const { sm, storage } = newDo(rpc);

  await sm.fetch(new Request("http://do/next")); // 43
  const stored = storage.map.get("state") as
    | { lastSeq: string; syncedAt: number }
    | undefined;
  assert.ok(stored, "storage should be populated after /next");
  assert.equal(stored.lastSeq, "43");
});
