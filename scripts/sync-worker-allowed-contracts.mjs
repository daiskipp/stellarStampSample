#!/usr/bin/env node
// Sync apps/worker/wrangler.toml's ALLOWED_CONTRACTS from .env.testnet.
//
// Usage:
//   node scripts/sync-worker-allowed-contracts.mjs            # write into wrangler.toml
//   node scripts/sync-worker-allowed-contracts.mjs --print    # only print CSV
//
// Inputs (from project-root .env.testnet, produced by deploy-testnet.sh +
// sa-setup-testnet.mjs):
//   VITE_VISIT_STAMPS_CONTRACT
//   VITE_BEANS_TOKEN_CONTRACT
//   VITE_BENEFITS_CONTRACT
//   VITE_BADGES_CONTRACT
//   VITE_REWARD_POLICY_CONTRACT
//   VITE_HQ_SMART_ACCOUNT
//
// The Worker's relayer-handler.ts gates POST /relayer's invokeContract calls
// against this CSV. createContract (passkey SA deploy) bypasses the gate by
// returning null from extractInvokeContractId — so the allowlist only needs
// the 5 dicekey contracts + the HQ SA (admin ops dispatched via relayer).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_FILE = join(ROOT, ".env.testnet");
const WRANGLER_TOML = join(ROOT, "apps/worker/wrangler.toml");

const REQUIRED_KEYS = [
  "VITE_VISIT_STAMPS_CONTRACT",
  "VITE_BEANS_TOKEN_CONTRACT",
  "VITE_BENEFITS_CONTRACT",
  "VITE_BADGES_CONTRACT",
  "VITE_REWARD_POLICY_CONTRACT",
  "VITE_HQ_SMART_ACCOUNT",
];

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function buildCsv(envMap) {
  const missing = REQUIRED_KEYS.filter((k) => !envMap[k]);
  if (missing.length > 0) {
    throw new Error(
      `.env.testnet missing or empty keys: ${missing.join(", ")}\n` +
        "Run scripts/deploy-testnet.sh + scripts/sa-setup-testnet.mjs first.",
    );
  }
  return REQUIRED_KEYS.map((k) => envMap[k]).join(",");
}

function updateWranglerToml(csv) {
  const text = readFileSync(WRANGLER_TOML, "utf8");
  const re = /^ALLOWED_CONTRACTS\s*=\s*".*"$/m;
  if (!re.test(text)) {
    throw new Error(
      `ALLOWED_CONTRACTS = "..." line not found in ${WRANGLER_TOML}`,
    );
  }
  const next = text.replace(re, `ALLOWED_CONTRACTS = "${csv}"`);
  if (next === text) return false;
  writeFileSync(WRANGLER_TOML, next);
  return true;
}

function main() {
  if (!existsSync(ENV_FILE)) {
    console.error(
      `ERROR: ${ENV_FILE} not found.\n` +
        "Run scripts/deploy-testnet.sh + scripts/sa-setup-testnet.mjs first.",
    );
    process.exit(1);
  }

  const envMap = parseEnv(readFileSync(ENV_FILE, "utf8"));
  const csv = buildCsv(envMap);
  const printOnly = process.argv.includes("--print");

  if (printOnly) {
    process.stdout.write(csv + "\n");
    return;
  }

  const changed = updateWranglerToml(csv);
  console.log(`ALLOWED_CONTRACTS = "${csv}"`);
  console.log(changed ? `Updated ${WRANGLER_TOML}` : `No change to ${WRANGLER_TOML}`);
}

main();
