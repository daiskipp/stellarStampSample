#!/usr/bin/env node
// Playwright runner that drives the in-browser sa-harness with a CDP virtual
// WebAuthn authenticator to set up the dicekey HQ Smart Account on localnet
// and empirically resolve U2 (does a staff passkey on one
// CallContract(visit-stamps) rule authorise the issue() cross-call tree?).
//
// Prereqs: tools/sa-harness Vite dev server running on http://localhost:5180
// and the kit deployer account funded on localnet (friendbot).
//
// Output: tools/sa-harness/fixtures.json + prints env updates for
// .env.localnet (VITE_HQ_SMART_ACCOUNT / VITE_HQ_STAFF_CONTEXT_RULE_ID /
// VITE_DEMO_CUSTOMER_SA).

import { chromium } from "@playwright/test";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:5180/";
const FIXTURES = join(ROOT, "tools/sa-harness/fixtures.json");
const ENV_FILE = join(ROOT, ".env.localnet");
// HQ values written by this runner must land in every .env a Vite consumer
// reads, otherwise staff-app/customer-app start up with empty
// VITE_HQ_SMART_ACCOUNT / VITE_HQ_ROOT_CREDENTIAL_ID after a fresh
// `just localnet`. `tools/sa-harness/.env` is intentionally excluded: the
// sa-harness Vite dev server is RUNNING while sa-setup executes, so writing
// to its .env triggers HMR mid-run and tears down Playwright's page context
// ("Execution context was destroyed, most likely because of a navigation").
// The harness reads contract ids only at deploy-localnet.sh time and doesn't
// need HQ values from this runner.
const ENV_FILES = [
  ENV_FILE,
  join(ROOT, "apps/customer-app/.env"),
  join(ROOT, "apps/staff-app/.env"),
];

const VISIT_STAMPS = grepEnv("VITE_VISIT_STAMPS_CONTRACT");
const BEANS_TOKEN = grepEnv("VITE_BEANS_TOKEN_CONTRACT");
const REWARD_POLICY = grepEnv("VITE_REWARD_POLICY_CONTRACT");

function grepEnv(key) {
  const txt = readFileSync(ENV_FILE, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim();
  }
  throw new Error(`${key} not in ${ENV_FILE}`);
}

function setEnvVar(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  for (const file of ENV_FILES) {
    let txt;
    try {
      txt = readFileSync(file, "utf8");
    } catch {
      continue; // optional consumer (e.g. tools/sa-harness/.env) not provisioned
    }
    if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`);
    else txt = txt.replace(/\n*$/, `\n${key}=${value}\n`);
    writeFileSync(file, txt);
  }
}

const out = {};
function record(k, v) {
  out[k] = v;
  console.log(`>> ${k} = ${JSON.stringify(v)}`);
}

let proxyProc = null;
function startProxy() {
  return new Promise((resolve, reject) => {
    proxyProc = spawn(
      process.execPath,
      [join(__dirname, "rpc-https-proxy.mjs")],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let done = false;
    proxyProc.stdout.on("data", (d) => {
      const s = d.toString();
      if (s.includes("rpc-https-proxy:") && !done) {
        done = true;
        console.log(s.trim());
        resolve();
      }
    });
    proxyProc.stderr.on("data", (d) =>
      console.log("proxy-stderr:", d.toString().trim()),
    );
    proxyProc.on("exit", (c) => {
      if (!done) reject(new Error("proxy exited early code " + c));
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, 3000);
  });
}

async function main() {
  await startProxy();
  // ignoreHTTPSErrors: the proxy uses a self-signed localhost cert.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[error]") || t.includes("FAIL") || t.includes("THREW"))
      console.log("  browser:", t);
  });

  // CDP virtual authenticator: ctap2 / internal / resident keys / UV on,
  // automatic presence so no user gesture is required.
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
  await page.waitForFunction(() => !!window.saHarness, null, { timeout: 15000 });
  const cfg = await page.evaluate(() => window.saHarness._config());
  console.log("harness config rpId:", cfg.rpId, "rpc:", cfg.rpcUrl);

  // ---- 1. HQ Smart Account ------------------------------------------------
  const hq = await page.evaluate(
    () => window.saHarness.createWallet("dicekey HQ", "hq-admin"),
  );
  if (!hq.ok) throw new Error("HQ createWallet failed: " + JSON.stringify(hq));
  record("VITE_HQ_SMART_ACCOUNT", hq.contractId);
  record("HQ_CREDENTIAL_ID", hq.credentialId);
  // Persist the HQ root credential id so staff-app's device enrollment can
  // read it from import.meta.env instead of asking an operator to paste it.
  if (hq.credentialId) {
    setEnvVar("VITE_HQ_ROOT_CREDENTIAL_ID", hq.credentialId);
  }

  // Snapshot CDP credentials so we know what (if anything) is reusable.
  const credsAfterHq = await client.send("WebAuthn.getCredentials", {
    authenticatorId,
  });
  out._cdpCredentialsAfterHq = credsAfterHq.credentials.map((c) => ({
    credentialId: c.credentialId,
    isResidentCredential: c.isResidentCredential,
    rpId: c.rpId,
    userHandle: c.userHandle,
    signCount: c.signCount,
  }));

  // ---- 2. staff-issue context rules (U2 case C) ---------------------------
  // issue()'s auth tree makes 3 admin.require_auth calls (issue@visit-stamps,
  // mint@beans-token, on_stamp_issued@reward-policy). OZ __check_auth needs
  // context_rule_ids index-aligned to those 3 auth_contexts, so one staff
  // passkey is registered on 3 CallContract rules (one per contract).
  const sr = await page.evaluate(
    () => window.saHarness.setupStaffRules("dicekey Staff", "shibuya"),
  );
  if (!sr.ok) throw new Error("setupStaffRules failed: " + JSON.stringify(sr));
  const staffRuleIds = sr.contextRuleIds; // [visit-stamps, beans-token, reward-policy]
  const benefitsRuleId = sr.benefitsRuleId; // 4th rule: benefits scope (Receive Benefit)
  record("VITE_HQ_STAFF_CONTEXT_RULE_ID", staffRuleIds[0]);
  record("VITE_HQ_STAFF_RULE_IDS", staffRuleIds.join(","));
  record("VITE_HQ_STAFF_BENEFITS_RULE_ID", benefitsRuleId);
  const staff = { shibuya: sr.staffCredentialId };
  record("STAFF_SHIBUYA_CREDENTIAL_ID", sr.staffCredentialId);

  // ---- 4. initialize 5 dicekey contracts (admin = HQ SA) ------------------
  const init = await page.evaluate(
    (hqc) => window.saHarness.initializeDicekey(hqc),
    hq.contractId,
  );
  out._initialize = init;
  console.log("initializeDicekey ok:", init.ok);
  if (!init.ok)
    console.log("  initialize results:", JSON.stringify(init.results));

  // ---- 5. wire visit-stamps -> beans / policy (HQ passkey, require_admin) -
  const wire = await page.evaluate(
    (hqc) => window.saHarness.wireContracts(hqc),
    hq.contractId,
  );
  out._wire = wire;
  console.log("wireContracts ok:", wire.ok);
  if (!wire.ok) console.log("  wire results:", JSON.stringify(wire.results));

  // ---- 6. demo customer SA ------------------------------------------------
  const cust = await page.evaluate(
    () => window.saHarness.createWallet("dicekey Coffee Stamps", "demo-customer"),
  );
  if (!cust.ok)
    throw new Error("customer createWallet failed: " + JSON.stringify(cust));
  record("VITE_DEMO_CUSTOMER_SA", cust.contractId);
  record("DEMO_CUSTOMER_CREDENTIAL_ID", cust.credentialId);

  // ---- 7. U2: staff passkey issues a stamp --------------------------------
  // Reconnect to the HQ SA (createWallet for the customer left the kit
  // connected to the customer wallet). kit 0.3.0's connectWallet requires a
  // credentialId (contractId alone -> "Could not determine credential ID");
  // pass both the HQ contractId and its credentialId.
  const recon = await page.evaluate(
    ([hqc, cred]) => window.saHarness.connectWallet({ contractId: hqc, credentialId: cred }),
    [hq.contractId, hq.credentialId],
  );
  out._reconnectHq = recon;

  // U2 case C: pass the 3 staff rule ids index-aligned to issue()'s 3
  // auth_contexts [visit-stamps, beans-token, reward-policy].
  const u2 = await page.evaluate(
    ([hqc, custc, cred, rids]) =>
      window.saHarness.issueStamp(hqc, custc, "shibuya", cred, rids),
    [hq.contractId, cust.contractId, staff.shibuya, staffRuleIds],
  );
  out._u2_caseC = u2;
  const u2Conclusion = u2.ok
    ? `PASS (case C): a staff passkey registered on 3 CallContract context ` +
      `rules [visit-stamps=${staffRuleIds[0]}, beans-token=${staffRuleIds[1]}, ` +
      `reward-policy=${staffRuleIds[2]}], with context_rule_ids index-aligned ` +
      `to issue()'s 3 auth_contexts, authorises the full issue() cross-call ` +
      `tree (beans-token.mint + reward-policy.on_stamp_issued). A single ` +
      `visit-stamps rule is NOT sufficient (#3014 ContextRuleIdsLengthMismatch).`
    : `FAIL (case C, ruleIds=[${staffRuleIds.join(",")}]). Error: ${u2.error || "unknown"}`;
  out._u2Conclusion = u2Conclusion;
  console.log("\n==== U2 CONCLUSION ====\n" + u2Conclusion + "\n");

  // ---- 8. verify stamp_count == 1 and beans balance == 10 -----------------
  const sc = await page.evaluate(
    (c) => window.saHarness.readStampCount(c),
    cust.contractId,
  );
  const bb = await page.evaluate(
    (c) => window.saHarness.getBeansBalance(c),
    cust.contractId,
  );
  out._stampCount = sc;
  out._beansBalance = bb;
  console.log(`stamp_count=${sc.value}  beans_balance=${bb.value}`);

  // ---- 9. Use Beans: customer approve -> staff burn_from ------------------
  // burn_from(spender=HQ, from=customer) needs a pre-existing customer->HQ
  // allowance. The customer's approve() is from.require_auth (the customer SA)
  // so the kit must be connected AS the customer (its single Default rule
  // authorises it). Then reconnect to HQ and the staff passkey burns the
  // allowance (beans-token staff rule, single auth_context).
  const beansBefore = bb.value;
  const approveAmt = beansBefore; // approve exactly the issued balance (10)
  const connCust = await page.evaluate(
    ([c, cred]) =>
      window.saHarness.connectWallet({ contractId: c, credentialId: cred }),
    [cust.contractId, cust.credentialId],
  );
  out._connectCustomerForApprove = connCust;
  const appr = await page.evaluate(
    ([c, cred, hqc, amt]) =>
      window.saHarness.approveBeans(c, cred, hqc, amt),
    [cust.contractId, cust.credentialId, hq.contractId, approveAmt],
  );
  out._approveBeans = appr;
  const allowAfterApprove = await page.evaluate(
    ([c, hqc]) => window.saHarness.getBeansAllowance(c, hqc),
    [cust.contractId, hq.contractId],
  );
  out._allowanceAfterApprove = allowAfterApprove;

  // Reconnect to HQ (staff burn_from is HQ.require_auth via spender).
  await page.evaluate(
    ([hqc, cred]) =>
      window.saHarness.connectWallet({ contractId: hqc, credentialId: cred }),
    [hq.contractId, hq.credentialId],
  );
  const ub = await page.evaluate(
    ([hqc, c, amt, cred, rid]) =>
      window.saHarness.staffUseBeans(hqc, c, amt, cred, rid),
    [hq.contractId, cust.contractId, approveAmt, staff.shibuya, staffRuleIds[1]],
  );
  out._useBeans = ub;
  const bbAfter = await page.evaluate(
    (c) => window.saHarness.getBeansBalance(c),
    cust.contractId,
  );
  out._beansBalanceAfterUse = bbAfter;
  const useBeansConclusion = ub.ok
    ? `PASS: customer approve(HQ,${approveAmt}) then staff burn_from -> ` +
      `beans ${beansBefore} -> ${bbAfter.value}`
    : `FAIL: ${ub.error || "unknown"}`;
  out._useBeansConclusion = useBeansConclusion;
  console.log("\n==== USE BEANS ====\n" + useBeansConclusion + "\n");

  // ---- 10. Receive Benefit: HQ mint -> staff burn_from -------------------
  // HQ mints a benefit voucher to the customer (require_admin(HQ), HQ root
  // signs, single Default rule). The staff passkey then redeems it via
  // benefits.burn_from (HQ.require_auth via require_admin, benefits staff
  // rule, single auth_context).
  const benBefore = await page.evaluate(
    (c) => window.saHarness.getBenefitsBalance(c),
    cust.contractId,
  );
  out._benefitCountBefore = benBefore;
  const mintBen = await page.evaluate(
    ([hqc, cred, c]) =>
      window.saHarness.mintBenefit(
        hqc,
        cred,
        c,
        "free_drink_voucher",
        0,
      ),
    [hq.contractId, hq.credentialId, cust.contractId],
  );
  out._mintBenefit = mintBen;
  const benAfterMint = await page.evaluate(
    (c) => window.saHarness.getBenefitsBalance(c),
    cust.contractId,
  );
  out._benefitCountAfterMint = benAfterMint;
  const idsList = await page.evaluate(
    (c) => window.saHarness.listBenefitIds(c),
    cust.contractId,
  );
  const tokenId =
    mintBen.ok && typeof mintBen.tokenId === "number"
      ? mintBen.tokenId
      : (idsList.ids && idsList.ids.length
          ? idsList.ids[idsList.ids.length - 1]
          : 0);
  const rcv = await page.evaluate(
    ([hqc, c, tid, cred, rid]) =>
      window.saHarness.staffReceiveBenefit(hqc, c, tid, cred, rid),
    [hq.contractId, cust.contractId, tokenId, staff.shibuya, benefitsRuleId],
  );
  out._receiveBenefit = rcv;
  const benAfterBurn = await page.evaluate(
    (c) => window.saHarness.getBenefitsBalance(c),
    cust.contractId,
  );
  out._benefitCountAfterBurn = benAfterBurn;
  const recvConclusion = rcv.ok
    ? `PASS: HQ mint -> count ${benBefore.value} -> ${benAfterMint.value}; ` +
      `staff burn_from(token ${tokenId}) -> ${benAfterBurn.value}`
    : `FAIL: ${rcv.error || "unknown"}`;
  out._receiveBenefitConclusion = recvConclusion;
  console.log("\n==== RECEIVE BENEFIT ====\n" + recvConclusion + "\n");

  // ---- persist + env ------------------------------------------------------
  out.staffCredentials = staff;
  out.hqContractId = hq.contractId;
  out.hqCredentialId = hq.credentialId;
  out.demoCustomerSA = cust.contractId;
  out.staffContextRuleIds = staffRuleIds;
  out.staffBenefitsRuleId = benefitsRuleId;
  out.harnessUrl = HARNESS_URL;
  out.note =
    "credentialIds are CDP virtual-authenticator generated. See _cdp* keys " +
    "for resident-key reuse constraints.";
  writeFileSync(FIXTURES, JSON.stringify(out, null, 2));

  if (hq.contractId) setEnvVar("VITE_HQ_SMART_ACCOUNT", hq.contractId);
  if (staffRuleIds && staffRuleIds.length === 3) {
    setEnvVar("VITE_HQ_STAFF_CONTEXT_RULE_ID", String(staffRuleIds[0]));
    setEnvVar("VITE_HQ_STAFF_RULE_IDS", staffRuleIds.join(","));
  }
  if (benefitsRuleId != null) {
    setEnvVar("VITE_HQ_STAFF_BENEFITS_RULE_ID", String(benefitsRuleId));
  }
  if (cust.contractId) setEnvVar("VITE_DEMO_CUSTOMER_SA", cust.contractId);

  await browser.close();
  if (proxyProc) proxyProc.kill();
  console.log("\nfixtures written:", FIXTURES);
}

main().catch((e) => {
  console.error("RUNNER FATAL:", e);
  try {
    writeFileSync(
      FIXTURES,
      JSON.stringify({ ...out, _fatal: String(e && e.stack || e) }, null, 2),
    );
  } catch {}
  if (proxyProc) proxyProc.kill();
  process.exit(1);
});
