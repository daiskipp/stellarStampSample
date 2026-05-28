import {
  Account,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  StellarBackend,
  SubmissionOutcome,
} from "./relayer-handler.ts";

// 🟡 Intent: narrow surface against the SequenceManager Durable Object so the
//    backend can be wired against a real DO stub (Worker runtime) or any
//    fetch-like stub at test time.
export interface SequenceClient {
  next(): Promise<bigint>;
  rollback(): Promise<void>;
}

// 🔵 Intent: spec line 80 — base fee 多めに. 1 XLM in stroops = 1e7. Soroban
//    transactions add a resource fee on top; this only covers the inclusion
//    portion so the buffer matters less, but the spec value is preserved.
const BASE_FEE = "10000000";

// 🟡 Intent: spec line 132 — fee-bump cap. 2 XLM. Reasonable headroom over
//    the typical Testnet resource fee for a deploy.
const FEE_BUMP_CAP = "20000000";

// 🔵 Intent: spec line 111 — 15 attempts (Testnet is 5-10s/ledger).
const POLL_ATTEMPTS = 15;

export interface StellarRpcBackendDeps {
  rpcUrl: string;
  feePayerSecret: string;
  networkPassphrase: string;
  sequence: SequenceClient;
  // Test seam — production omits to use the real RPC + Keypair pair.
  overrides?: {
    rpc?: rpc.Server;
    feePayer?: Keypair;
  };
}

// 🔵 Intent: production StellarBackend impl wiring DO sequence → tx build →
//    simulate (prepareTransaction) → sign → submit → poll. rollback fires
//    on any failure between seq fetch and successful send so the next /next
//    re-issues the same seq.
export class StellarRpcBackend implements StellarBackend {
  private readonly rpcClient: rpc.Server;
  private readonly kp: Keypair;
  private readonly networkPassphrase: string;
  private readonly sequence: SequenceClient;

  constructor(deps: StellarRpcBackendDeps) {
    this.rpcClient = deps.overrides?.rpc ?? new rpc.Server(deps.rpcUrl);
    this.kp =
      deps.overrides?.feePayer ?? Keypair.fromSecret(deps.feePayerSecret);
    this.networkPassphrase = deps.networkPassphrase;
    this.sequence = deps.sequence;
  }

  async submitFuncAuth(
    funcB64: string,
    authB64s: string[],
  ): Promise<SubmissionOutcome> {
    let seq: bigint;
    try {
      seq = await this.sequence.next();
    } catch (e) {
      return { status: "simulation_failed", error: `seq fetch: ${msg(e)}` };
    }

    let func: xdr.HostFunction;
    let authEntries: xdr.SorobanAuthorizationEntry[];
    try {
      func = xdr.HostFunction.fromXDR(funcB64, "base64");
      authEntries = authB64s.map((a) =>
        xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"),
      );
    } catch (e) {
      await this.sequence.rollback();
      return { status: "simulation_failed", error: `xdr parse: ${msg(e)}` };
    }

    const account = new Account(this.kp.publicKey(), seq.toString());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({ func, auth: authEntries }),
      )
      .setTimeout(300)
      .build();

    let prepared;
    try {
      prepared = await this.rpcClient.prepareTransaction(tx);
    } catch (e) {
      await this.sequence.rollback();
      return { status: "simulation_failed", error: msg(e) };
    }

    prepared.sign(this.kp);
    return this.sendAndPoll(prepared, true);
  }

  async submitXdr(xdrB64: string): Promise<SubmissionOutcome> {
    let inner;
    try {
      inner = TransactionBuilder.fromXDR(xdrB64, this.networkPassphrase);
    } catch (e) {
      return { status: "simulation_failed", error: `invalid xdr: ${msg(e)}` };
    }

    // 🟡 Intent: fee-bump tx have no seq of their own — they ride the inner
    //    tx's seq. So no DO interaction for this path. The inner tx must be
    //    already signed by its source account (kit's deployment path does
    //    this — see .oz-build/.../tx-ops.ts where source_account auth makes
    //    the kit sign with deployerKeypair before relayer dispatch).
    if (inner.constructor.name === "FeeBumpTransaction") {
      return { status: "simulation_failed", error: "fee-bump tx not allowed as inner" };
    }
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.kp,
      FEE_BUMP_CAP,
      // @ts-expect-error — narrowed at runtime above; sdk's union type is loose.
      inner,
      this.networkPassphrase,
    );
    feeBump.sign(this.kp);
    return this.sendAndPoll(feeBump, false);
  }

  private async sendAndPoll(
    tx: Parameters<rpc.Server["sendTransaction"]>[0],
    rollbackOnFail: boolean,
  ): Promise<SubmissionOutcome> {
    let send: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
    try {
      send = await this.rpcClient.sendTransaction(tx);
    } catch (e) {
      if (rollbackOnFail) await this.sequence.rollback();
      return { status: "onchain_failed", error: `send: ${msg(e)}` };
    }

    if (send.status === "ERROR") {
      if (rollbackOnFail) await this.sequence.rollback();
      return {
        status: "onchain_failed",
        hash: send.hash,
        error: send.errorResult?.toXDR("base64") ?? "send error",
      };
    }

    let poll;
    try {
      poll = await this.rpcClient.pollTransaction(send.hash, {
        attempts: POLL_ATTEMPTS,
      });
    } catch (e) {
      return {
        status: "onchain_failed",
        hash: send.hash,
        error: `poll: ${msg(e)}`,
      };
    }

    if (poll.status === "SUCCESS") {
      return { status: "success", hash: send.hash };
    }
    if (poll.status === "FAILED") {
      return {
        status: "onchain_failed",
        hash: send.hash,
        error: "tx failed on-chain",
      };
    }
    return { status: "pending", hash: send.hash };
  }
}

// 🔵 Intent: bridge a Cloudflare DurableObjectNamespace to SequenceClient.
//    Funnels everything into `idFromName("default")` so all Worker isolates
//    talk to the same single-threaded DO instance (race-free seq assignment).
export function makeDurableObjectSequenceClient(
  ns: DurableObjectNamespace,
): SequenceClient {
  const stub = () => ns.get(ns.idFromName("default"));
  return {
    async next() {
      const r = await stub().fetch("https://do/next", { method: "POST" });
      const j = (await r.json()) as { seq: string };
      return BigInt(j.seq);
    },
    async rollback() {
      await stub().fetch("https://do/rollback", { method: "POST" });
    },
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
