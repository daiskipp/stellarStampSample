import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import app, { SequenceManager } from "../src/index.ts";

// Valid-format throwaway secret so StellarRpcBackend's constructor succeeds.
// Tests in this file only exercise CORS + body validation paths, never
// the live Stellar RPC, so this never signs anything real.
const env = {
  FEE_PAYER_SECRET: Keypair.random().secret(),
  RPC_URL: "https://soroban-testnet.stellar.org",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  ALLOWED_ORIGINS:
    "https://dicekey-customer-app.pages.dev,https://dicekey-staff-app.pages.dev",
  ALLOWED_CONTRACTS: "",
  SEQUENCE_MANAGER: undefined as unknown as DurableObjectNamespace,
};

test("GET /health returns 200 'ok'", async () => {
  const res = await app.fetch(new Request("http://w/health"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});

test("OPTIONS /relayer with allowed origin returns 204 and Allow-Origin", async () => {
  const res = await app.fetch(
    new Request("http://w/relayer", {
      method: "OPTIONS",
      headers: {
        Origin: "https://dicekey-customer-app.pages.dev",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "https://dicekey-customer-app.pages.dev",
  );
});

test("OPTIONS /relayer from disallowed origin omits Allow-Origin", async () => {
  const res = await app.fetch(
    new Request("http://w/relayer", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
    env,
  );
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assert.ok(
    allowOrigin === null || allowOrigin === "",
    `expected no Allow-Origin for evil origin, got ${allowOrigin}`,
  );
});

test("POST /relayer with empty body returns 400 INVALID_PARAMS", async () => {
  const res = await app.fetch(
    new Request("http://w/relayer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://dicekey-customer-app.pages.dev",
      },
      body: JSON.stringify({}),
    }),
    env,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { success: boolean; errorCode: string };
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "INVALID_PARAMS");
});

test("POST /relayer from disallowed origin is rejected (no Allow-Origin header)", async () => {
  const res = await app.fetch(
    new Request("http://w/relayer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({}),
    }),
    env,
  );
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assert.ok(
    allowOrigin === null || allowOrigin === "",
    `expected no Allow-Origin for evil origin, got ${allowOrigin}`,
  );
});

test("SequenceManager Durable Object class is exported (Task 009 placeholder)", () => {
  assert.equal(typeof SequenceManager, "function");
});
