import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  createRelayerHandler,
  type RelayerDeps,
  type SubmissionOutcome,
} from "../src/relayer-handler.ts";

type Recorded = {
  funcAuth: Array<{ funcB64: string; authB64s: string[] }>;
  xdr: string[];
};

function makeBackend(
  outcome: SubmissionOutcome,
  recorded: Recorded = { funcAuth: [], xdr: [] },
) {
  return {
    recorded,
    backend: {
      async submitFuncAuth(funcB64: string, authB64s: string[]) {
        recorded.funcAuth.push({ funcB64, authB64s });
        return outcome;
      },
      async submitXdr(xdrB64: string) {
        recorded.xdr.push(xdrB64);
        return outcome;
      },
    },
  };
}

function makeApp(deps: RelayerDeps) {
  const app = new Hono();
  app.post("/relayer", createRelayerHandler(deps));
  return async (
    body: unknown,
    opts?: { contentType?: string },
  ): Promise<Response> =>
    await app.fetch(
      new Request("http://w/relayer", {
        method: "POST",
        headers: {
          "Content-Type": opts?.contentType ?? "application/json",
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
}

test("body without func/auth or xdr returns 400 INVALID_PARAMS", async () => {
  const { backend } = makeBackend({ status: "success", hash: "h" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ unrelated: 1 });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { success: boolean; errorCode: string };
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "INVALID_PARAMS");
});

test("malformed JSON returns 400 INVALID_PARAMS", async () => {
  const { backend } = makeBackend({ status: "success", hash: "h" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post("{not-json", { contentType: "application/json" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "INVALID_PARAMS");
});

test("{xdr} with non-string xdr returns 400 INVALID_XDR", async () => {
  const { backend } = makeBackend({ status: "success", hash: "h" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ xdr: 123 });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "INVALID_XDR");
});

test("{func, auth} with target NOT in allowlist returns 403 UNAUTHORIZED", async () => {
  const { backend, recorded } = makeBackend({
    status: "success",
    hash: "should-not-submit",
  });
  const post = makeApp({
    backend,
    allowedContracts: [
      "CALLOWED000000000000000000000000000000000000000000000000",
    ],
    extractTarget: () => "CFORBIDDEN0000000000000000000000000000000000000000000000",
  });

  const res = await post({ func: "F", auth: ["A1"] });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { errorCode: string; error: string };
  assert.equal(body.errorCode, "UNAUTHORIZED");
  assert.match(body.error, /not in allowlist/);
  assert.equal(
    recorded.funcAuth.length,
    0,
    "backend must not be called when target is forbidden",
  );
});

test("{func, auth} succeeds when target IS in allowlist; backend receives func/auth", async () => {
  const target = "CALLOWED000000000000000000000000000000000000000000000000";
  const { backend, recorded } = makeBackend({
    status: "success",
    hash: "txhash123",
  });
  const post = makeApp({
    backend,
    allowedContracts: [target],
    extractTarget: () => target,
  });

  const res = await post({ func: "F-XDR", auth: ["A1", "A2"] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    success: boolean;
    hash: string;
    status: string;
  };
  assert.equal(body.success, true);
  assert.equal(body.hash, "txhash123");
  assert.equal(body.status, "SUCCESS");

  assert.deepEqual(recorded.funcAuth, [
    { funcB64: "F-XDR", authB64s: ["A1", "A2"] },
  ]);
});

test("empty allowedContracts disables allowlist (allow all)", async () => {
  const { backend, recorded } = makeBackend({
    status: "success",
    hash: "ok",
  });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => "Cany",
  });

  const res = await post({ func: "F", auth: [] });
  assert.equal(res.status, 200);
  assert.equal(recorded.funcAuth.length, 1);
});

test("extractTarget returning null bypasses allowlist (cannot determine contract)", async () => {
  // 🟡 By spec: `target && !allowed.includes(target)` — null target skips
  // the gate. Tracking this as a behavior so future tightening is intentional.
  const { backend, recorded } = makeBackend({
    status: "success",
    hash: "ok",
  });
  const post = makeApp({
    backend,
    allowedContracts: ["Cwhatever"],
    extractTarget: () => null,
  });

  const res = await post({ func: "F", auth: [] });
  assert.equal(res.status, 200);
  assert.equal(recorded.funcAuth.length, 1);
});

test("backend SIMULATION_FAILED → 502 SIMULATION_FAILED", async () => {
  const { backend } = makeBackend({
    status: "simulation_failed",
    error: "host fn xyz",
  });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ func: "F", auth: [] });
  assert.equal(res.status, 502);
  const body = (await res.json()) as {
    success: boolean;
    errorCode: string;
    error: string;
  };
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "SIMULATION_FAILED");
  assert.equal(body.error, "host fn xyz");
});

test("backend ONCHAIN_FAILED with hash → 502 ONCHAIN_FAILED + hash echoed", async () => {
  const { backend } = makeBackend({
    status: "onchain_failed",
    hash: "h123",
    error: "tx_failed",
  });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ func: "F", auth: [] });
  assert.equal(res.status, 502);
  const body = (await res.json()) as {
    success: boolean;
    errorCode: string;
    hash: string;
  };
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "ONCHAIN_FAILED");
  assert.equal(body.hash, "h123");
});

test("backend PENDING → 200 success:true with status PENDING (kit re-polls)", async () => {
  // 🔵 Intent: kit's submitWithRelayer (.oz-build/.../tx-ops.ts:128) calls
  //    rpc.pollTransaction(hash) on success, so returning success+pending lets
  //    the kit continue polling on its side.
  const { backend } = makeBackend({ status: "pending", hash: "pendinghash" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ func: "F", auth: [] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    success: boolean;
    hash: string;
    status: string;
  };
  assert.equal(body.success, true);
  assert.equal(body.hash, "pendinghash");
  assert.equal(body.status, "PENDING");
});

test("{xdr} path forwards to backend.submitXdr and returns hash", async () => {
  const { backend, recorded } = makeBackend({
    status: "success",
    hash: "feebumped",
  });
  const post = makeApp({
    backend,
    allowedContracts: ["Cany"],
    extractTarget: () => "Cany",
  });

  const res = await post({ xdr: "AAAA-base64-xdr" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; hash: string };
  assert.equal(body.success, true);
  assert.equal(body.hash, "feebumped");
  assert.deepEqual(recorded.xdr, ["AAAA-base64-xdr"]);
  assert.equal(recorded.funcAuth.length, 0);
});

test("{func, auth} requires auth to be array of strings", async () => {
  const { backend } = makeBackend({ status: "success", hash: "h" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ func: "F", auth: "not-an-array" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "INVALID_PARAMS");
});

test("{func, auth} requires func to be a string", async () => {
  const { backend } = makeBackend({ status: "success", hash: "h" });
  const post = makeApp({
    backend,
    allowedContracts: [],
    extractTarget: () => null,
  });

  const res = await post({ func: 42, auth: [] });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "INVALID_PARAMS");
});
