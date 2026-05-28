#!/usr/bin/env node
// Testnet variant of scripts/sa-setup.mjs.
//
// Bootstraps the dicekey HQ Smart Account on Stellar Testnet:
//   1. Friendbot-fund the smart-account-kit deterministic fee payer.
//   2. Copy .env.testnet -> tools/sa-harness/.env.testnet so the harness Vite
//      (started with `--mode testnet`) reads Testnet contract ids + RPC URL.
//   3. Spawn `pnpm --filter sa-harness dev --mode testnet`, drive it with a
//      CDP virtual WebAuthn authenticator (same pattern as the localnet flow):
//        - createWallet HQ            -> HQ SA + HQ root credential
//        - setupStaffRules            -> 3 issue rules + 1 benefits rule
//        - initializeDicekey + wire   -> admin = HQ SA, cross-contract links
//        - createWallet customer      -> demo customer SA
//        - issueStamp                 -> 1 on-chain U2 case-C smoke
//   4. Write HQ SA / staff rule ids / customer SA back into .env.testnet and
//      a separate fixtures.testnet.json. localnet flow is untouched.
//
// Prereqs: scripts/deploy-testnet.sh has produced a fresh .env.testnet (HQ SA
// / rule id keys blank). NOT idempotent against an already-bootstrapped run —
// re-running will trap `already initialized`; re-deploy first.

import { chromium } from "@playwright/test";
import {
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_FILE = join(ROOT, ".env.testnet");
const HARNESS_ENV = join(ROOT, "tools/sa-harness/.env.testnet");
const FIXTURES = join(ROOT, "tools/sa-harness/fixtures.testnet.json");
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:5180/";
const FRIENDBOT = process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";

// Testnet writes ONLY to the project-root .env.testnet — apps/*/.env are
// intentionally NOT updated. Those files carry the localnet RPC URL +
// contract ids for `pnpm --filter <app> dev` localnet workflow; mixing in
// Testnet HQ values would leave apps with a Testnet HQ SA pointing at
// localnet contracts (admin mismatch). CF Pages builds get the Testnet
// values via apps/*/.env.production (template under git) or the Pages
// dashboard, not from this runner.

if (!existsSync(ENV_FILE)) {
  console.error(`ERROR: ${ENV_FILE} not found. Run scripts/deploy-testnet.sh first.`);
  process.exit(1);
}

// 🔵 Intent: Same derivation as scripts/fund-localnet.mjs — the kit's fee
//    payer key is deterministic from the seed "openzeppelin-smart-account-kit"
//    regardless of network. Truncated form in CLAUDE.md is "GAAH4OT3...".
const require = createRequire(join(ROOT, "tools/sa-harness/package.json"));
const { Keypair, hash } = require("@stellar/stellar-sdk");
const KIT_DEPLOYER = Keypair.fromRawEd25519Seed(
  hash(Buffer.from("openzeppelin-smart-account-kit")),
).publicKey();

function grepEnv(key) {
  const txt = readFileSync(ENV_FILE, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim();
  }
  throw new Error(`${key} not in ${ENV_FILE}`);
}

function setEnvVar(key, value) {
  let txt = readFileSync(ENV_FILE, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`);
  else txt = txt.replace(/\n*$/, `\n${key}=${value}\n`);
  writeFileSync(ENV_FILE, txt);
}

// 🟡 Intent: Testnet friendbot occasionally rate-limits (HTTP 429) or returns
//    a transient 5xx. `already funded` (400) is treated as success — the only
//    invariant we need is "account exists on ledger". 3 attempts with 5s
//    spacing is more than enough for the public friendbot.
async function fundWithRetry(addr, label, maxAttempts = 3) {
  for (let i = 1; i <= maxAttempts; i++) {
    let res;
    try {
      res = await fetch(`${FRIENDBOT}/?addr=${addr}`, { method: "GET" });
    } catch (e) {
      console.log(`[fund] ${label} (${i}/${maxAttempts}): network error — ${e}`);
      await sleep(5000);
      continue;
    }
    const txt = await res.text();
    if (res.ok) {
      console.log(`[fund] ${label} ${addr}: funded`);
      return;
    }
    if (txt.includes("already funded") || txt.includes("createAccountAlreadyExist")) {
      console.log(`[fund] ${label} ${addr}: already funded (ok)`);
      return;
    }
    console.log(`[fund] ${label} (${i}/${maxAttempts}): friendbot ${res.status} — ${txt.slice(0, 160)}`);
    if (res.status === 429) {
      await sleep(5000);
    } else {
      await sleep(2000);
    }
  }
  throw new Error(`[fund] ${label}: gave up after ${maxAttempts} attempts`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 🟡 Intent: Harness Vite (envDir = ".") merges `.env` then `.env.testnet`
//    when launched with `--mode testnet`. Copying the project-root
//    .env.testnet wholesale guarantees every key (RPC URL, contract ids, RP
//    info) overrides the localnet defaults baked into the harness `.env`.
function syncHarnessEnv() {
  copyFileSync(ENV_FILE, HARNESS_ENV);
  console.log(`[sync] ${ENV_FILE} -> ${HARNESS_ENV}`);
}

let harnessProc = null;
function startHarness() {
  return new Promise((resolve, reject) => {
    harnessProc = spawn(
      "pnpm",
      ["--filter", "sa-harness", "dev", "--mode", "testnet"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let done = false;
    const onData = (d) => {
      const s = d.toString();
      if (!done && s.includes("Local:")) {
        done = true;
        resolve();
      }
    };
    harnessProc.stdout.on("data", onData);
    harnessProc.stderr.on("data", onData);
    harnessProc.on("exit", (c) => {
      if (!done) reject(new Error(`harness exited early code ${c}`));
    });
    // Vite may have already printed "Local:" before our listeners attached;
    // assume up after 40s.
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, 40000);
  });
}

const out = {};
function record(k, v) {
  out[k] = v;
  console.log(`>> ${k} = ${JSON.stringify(v)}`);
}

async function isHarnessUp() {
  try {
    const res = await fetch(HARNESS_URL, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  // Sanity: contract ids must already be present from deploy-testnet.sh.
  const VISIT_STAMPS = grepEnv("VITE_VISIT_STAMPS_CONTRACT");
  const BEANS_TOKEN = grepEnv("VITE_BEANS_TOKEN_CONTRACT");
  const REWARD_POLICY = grepEnv("VITE_REWARD_POLICY_CONTRACT");
  if (!VISIT_STAMPS || !BEANS_TOKEN || !REWARD_POLICY) {
    throw new Error(
      "VITE_*_CONTRACT empty in .env.testnet — run scripts/deploy-testnet.sh first",
    );
  }

  await fundWithRetry(KIT_DEPLOYER, "kit-deployer");

  // 🟡 Two run modes:
  //   A) Standalone (`node scripts/sa-setup-testnet.mjs`): harness is not up,
  //      we spawn it ourselves and sync env first.
  //   B) just testnet: the recipe already spawned the harness in the
  //      background BEFORE invoking us, and deploy-testnet.sh already
  //      mirrored .env.testnet -> tools/sa-harness/.env.testnet. Skip both
  //      spawn and env sync — writing tools/sa-harness/.env.testnet here
  //      would trigger HMR mid-run and tear down Playwright's page context.
  if (await isHarnessUp()) {
    console.log(
      `[sa-setup-testnet] harness already up at ${HARNESS_URL} — skipping spawn + env sync`,
    );
  } else {
    syncHarnessEnv();
    await startHarness();
    await sleep(2500); // socket bind
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[error]") || t.includes("FAIL") || t.includes("THREW"))
      console.log("  browser:", t);
  });

  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  console.log("virtual authenticator:", authenticatorId);

  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.saHarness, null, { timeout: 20000 });
  const cfg = await page.evaluate(() => window.saHarness._config());
  console.log("harness config rpId:", cfg.rpId, "rpc:", cfg.rpcUrl);

  // 🔴 Hard-stop on stale localnet harness: if a pre-existing harness was up
  //    at HARNESS_URL when we probed, it's likely from `just hq-setup` /
  //    `just localnet` and reading .env (Standalone passphrase). Driving it
  //    with Testnet env (HQ SA created on localnet, then initialize attempted
  //    on already-initialized localnet contracts) traps UnreachableCodeReached
  //    halfway through and corrupts neither network. Catch the mismatch BEFORE
  //    we createWallet, so the operator can kill the stale harness and retry.
  const passphraseFromHarness = String(cfg.networkPassphrase || "");
  const expected = grepEnv("VITE_NETWORK_PASSPHRASE");
  if (passphraseFromHarness !== expected) {
    throw new Error(
      `harness networkPassphrase mismatch:\n` +
      `  harness reports: "${passphraseFromHarness}"\n` +
      `  .env.testnet:    "${expected}"\n` +
      `A stale localnet harness is likely still bound to :5180. Kill it ` +
      `(pkill -f 'sa-harness') and re-run \`just testnet\`.`,
    );
  }

  // ---- 1. HQ Smart Account -------------------------------------------------
  const hq = await page.evaluate(
    () => window.saHarness.createWallet("dicekey HQ", "hq-admin"),
  );
  if (!hq.ok) throw new Error("HQ createWallet failed: " + JSON.stringify(hq));
  record("VITE_HQ_SMART_ACCOUNT", hq.contractId);
  record("HQ_CREDENTIAL_ID", hq.credentialId);
  // Persist the HQ root credential id early so staff-app's device enrollment
  // can read it from import.meta.env instead of asking an operator to paste it
  // (mirrors scripts/sa-setup.mjs:152-154).
  if (hq.credentialId) {
    setEnvVar("VITE_HQ_ROOT_CREDENTIAL_ID", hq.credentialId);
  }

  // ---- 2. staff rules (3 issue contexts + 1 benefits) ---------------------
  const sr = await page.evaluate(
    () => window.saHarness.setupStaffRules("dicekey Staff", "shibuya"),
  );
  if (!sr.ok) throw new Error("setupStaffRules failed: " + JSON.stringify(sr));
  const staffRuleIds = sr.contextRuleIds;
  const benefitsRuleId = sr.benefitsRuleId;
  record("VITE_HQ_STAFF_RULE_IDS", staffRuleIds.join(","));
  record("VITE_HQ_STAFF_CONTEXT_RULE_ID", staffRuleIds[0]);
  record("VITE_HQ_STAFF_BENEFITS_RULE_ID", benefitsRuleId);

  // ---- 3. initialize 5 dicekey contracts (admin = HQ SA) ------------------
  const init = await page.evaluate(
    (hqc) => window.saHarness.initializeDicekey(hqc),
    hq.contractId,
  );
  if (!init.ok) {
    throw new Error("initializeDicekey failed: " + JSON.stringify(init.results));
  }

  // ---- 4. wire visit-stamps -> beans / policy ----------------------------
  const wire = await page.evaluate(
    (hqc) => window.saHarness.wireContracts(hqc),
    hq.contractId,
  );
  if (!wire.ok) {
    throw new Error("wireContracts failed: " + JSON.stringify(wire.results));
  }

  // ---- 5. demo customer SA ------------------------------------------------
  const cust = await page.evaluate(
    () => window.saHarness.createWallet("dicekey Coffee Stamps", "demo-customer"),
  );
  if (!cust.ok) {
    throw new Error("customer createWallet failed: " + JSON.stringify(cust));
  }
  record("VITE_DEMO_CUSTOMER_SA", cust.contractId);

  // ---- 6. reconnect to HQ (kit currently connected to customer SA) -------
  await page.evaluate(
    ([hqc, cred]) =>
      window.saHarness.connectWallet({ contractId: hqc, credentialId: cred }),
    [hq.contractId, hq.credentialId],
  );

  // ---- 7. issue 1 stamp (U2 case C smoke) --------------------------------
  const u2 = await page.evaluate(
    ([hqc, custc, cred, rids]) =>
      window.saHarness.issueStamp(hqc, custc, "shibuya", cred, rids),
    [hq.contractId, cust.contractId, sr.staffCredentialId, staffRuleIds],
  );
  if (!u2.ok) {
    throw new Error(`issueStamp failed: ${u2.error || "unknown"}`);
  }
  console.log("issueStamp ok");

  // ---- 8. verify on-chain reads -----------------------------------------
  const sc = await page.evaluate(
    (c) => window.saHarness.readStampCount(c),
    cust.contractId,
  );
  const bb = await page.evaluate(
    (c) => window.saHarness.getBeansBalance(c),
    cust.contractId,
  );
  console.log(`stamp_count=${sc.value}  beans_balance=${bb.value}`);
  out._stampCount = sc;
  out._beansBalance = bb;

  // ---- 9. persist + write back to .env.testnet --------------------------
  setEnvVar("VITE_HQ_SMART_ACCOUNT", hq.contractId);
  setEnvVar("VITE_HQ_STAFF_CONTEXT_RULE_ID", String(staffRuleIds[0]));
  setEnvVar("VITE_HQ_STAFF_RULE_IDS", staffRuleIds.join(","));
  setEnvVar("VITE_HQ_STAFF_BENEFITS_RULE_ID", String(benefitsRuleId));
  setEnvVar("VITE_DEMO_CUSTOMER_SA", cust.contractId);

  writeFileSync(
    FIXTURES,
    JSON.stringify(
      {
        network: "testnet",
        hqContractId: hq.contractId,
        hqCredentialId: hq.credentialId,
        staffContextRuleIds: staffRuleIds,
        staffBenefitsRuleId: benefitsRuleId,
        staffCredentialId: sr.staffCredentialId,
        demoCustomerSA: cust.contractId,
        demoCustomerCredentialId: cust.credentialId,
        ...out,
      },
      null,
      2,
    ),
  );

  await browser.close();
  if (harnessProc) harnessProc.kill();
  console.log("\nfixtures written:", FIXTURES);
  console.log(".env.testnet updated with HQ SA / rule ids / customer SA");
}

main().catch((e) => {
  console.error("RUNNER FATAL:", e);
  if (harnessProc) harnessProc.kill();
  process.exit(1);
});
