#!/usr/bin/env node
// Idempotently fund the two G-accounts the E2E one-shot pipeline needs:
//
//   1. The smart-account-kit deterministic deployer/fee payer
//      Keypair.fromRawEd25519Seed(hash("openzeppelin-smart-account-kit")).
//      The kit submits every SA tx from this source account (no relayer); it
//      must exist & be funded on localnet. NOTE: the CLAUDE.md / scripts
//      shorthand "GAAH4OT3..." is a truncation — the full key is derived here.
//   2. scripts/deploy-localnet.sh's deploy identity (VITE_DEPLOYER_ADDRESS in
//      .env.localnet) — deploy-localnet.sh also friendbots it, but funding it
//      here too keeps a stale-CLI-identity edge case from blocking deploy.
//
// friendbot returns 400 "account already funded to starting balance" once an
// account exists — treated as success (idempotent). Network-unreachable / any
// other failure is reported but non-fatal (deploy-localnet.sh re-funds its own
// identity; the kit account error will surface later with a clearer message).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_FILE = join(ROOT, ".env.localnet");

// Resolve @stellar/stellar-sdk from a workspace pkg that depends on it.
const require = createRequire(
  join(ROOT, "tools/sa-harness/package.json"),
);
const { Keypair, hash } = require("@stellar/stellar-sdk");

function grepEnv(key, fallback) {
  try {
    const txt = readFileSync(ENV_FILE, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

const friendbotBase =
  grepEnv("VITE_FRIENDBOT_URL", "http://stellar-localnet:8000/friendbot");

const kitDeployer = Keypair.fromRawEd25519Seed(
  hash(Buffer.from("openzeppelin-smart-account-kit")),
).publicKey();
const deployIdentity = grepEnv(
  "VITE_DEPLOYER_ADDRESS",
  "GCNXD36WVN65BVTYDE3SCHXGBLANLOA74CH754ZNPVOQ6IRG3R4CGWLD",
);

async function fund(addr, label) {
  const url = `${friendbotBase}?addr=${addr}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const txt = await res.text();
    if (res.ok) {
      console.log(`[fund] ${label} ${addr}: funded`);
      return;
    }
    if (txt.includes("already funded")) {
      console.log(`[fund] ${label} ${addr}: already funded (ok)`);
      return;
    }
    console.log(
      `[fund] ${label} ${addr}: friendbot ${res.status} — ${txt.slice(0, 160)}`,
    );
  } catch (e) {
    console.log(`[fund] ${label} ${addr}: request failed — ${String(e)}`);
  }
}

await fund(kitDeployer, "kit-deployer");
await fund(deployIdentity, "deploy-identity");
console.log("[fund] done");
