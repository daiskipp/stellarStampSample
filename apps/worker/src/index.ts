import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRelayerHandler } from "./relayer-handler.ts";
import {
  StellarRpcBackend,
  makeDurableObjectSequenceClient,
} from "./stellar-backend.ts";
import { extractInvokeContractId } from "./xdr-helpers.ts";

type Env = {
  Bindings: {
    FEE_PAYER_SECRET: string;
    RPC_URL: string;
    NETWORK_PASSPHRASE: string;
    ALLOWED_ORIGINS: string;
    ALLOWED_CONTRACTS: string;
    SEQUENCE_MANAGER: DurableObjectNamespace;
  };
};

// 🔵 Intent: Task 008/010 — Hono on CF Workers. CORS Origin allowlist,
//    GET /health for uptime, POST /relayer implementing kit's official
//    relayer protocol.
const app = new Hono<Env>();

// 🔵 Intent: spec requires Origin to be in ALLOWED_ORIGINS (csv from env).
//    `cors()` reflects the request Origin only when the predicate returns it,
//    so disallowed origins receive no Access-Control-Allow-Origin header.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGINS.split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      return allowed.includes(origin) ? origin : "";
    },
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// 🔵 Intent: simple liveness probe (CF Pages / monitoring).
app.get("/health", (c) => c.text("ok"));

// 🔵 Intent: Task 010 — POST /relayer wires the per-request StellarRpcBackend
//    against this Worker's env (RPC, fee payer secret, DO seq manager) and
//    delegates to the pure handler. Constructed per request so the Keypair
//    + RPC client are scoped to one invocation (no shared state between
//    requests, matches the kit's expectation of stateless POSTs).
app.post("/relayer", (c) => {
  const allowedContracts = c.env.ALLOWED_CONTRACTS.split(",")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  const backend = new StellarRpcBackend({
    rpcUrl: c.env.RPC_URL,
    feePayerSecret: c.env.FEE_PAYER_SECRET,
    networkPassphrase: c.env.NETWORK_PASSPHRASE,
    sequence: makeDurableObjectSequenceClient(c.env.SEQUENCE_MANAGER),
  });
  return createRelayerHandler({
    backend,
    allowedContracts,
    extractTarget: extractInvokeContractId,
  })(c);
});

// 🔵 Intent: Task 009 implementation. Re-exported here because wrangler.toml's
//    `[[durable_objects.bindings]]` points class_name at this script's exports.
export { SequenceManager } from "./sequence-manager.ts";

export default app;
