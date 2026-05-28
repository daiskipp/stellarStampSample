#!/usr/bin/env node
// Best-effort end-to-end smoke for the MULTI-SIG staff-app.
//
// One Playwright browser + ONE persistent CDP virtual WebAuthn authenticator
// so the HQ root passkey created via the sa-harness page is also visible to
// the staff-app page (same authenticator, same rpId=localhost):
//
//   1. sa-harness (http://localhost:5180): createWallet HQ -> HQ SA +
//      HQ_CREDENTIAL_ID; setupStaffRules -> 3 staff CallContract rules;
//      initializeDicekey + wireContracts (admin = HQ SA); createWallet demo
//      customer -> customer SA.
//   2. staff-app (http://127.0.0.1:5174): "この端末を登録" with the HQ root
//      credential id -> creates a staff passkey + 3 fresh staff rules on the
//      HQ SA (proven setupStaffRules shape, signed by HQ root).
//   3. staff-app sign in (venue=渋谷) -> connect kit to HQ SA with staff cred.
//   4. IssueStamp: paste the demo customer SA -> visit-stamps.issue(admin=HQ)
//      resolved against the 3 staff rule ids (U2 case C) -> on-chain.
//   5. Assert the success screen shows stamp_count >= 1 and beans >= 10.
//
// Prereqs: localnet up, kit deployer (GAAH4OT3...) funded, sa-harness Vite dev
// server on :5180 (tools/sa-harness). NOT wired into CI; run manually.

import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:5180/";
const STAFF_URL = process.env.STAFF_URL || "http://127.0.0.1:5174/";

function waitFor(proc, needle, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const onData = (d) => {
      const s = d.toString();
      if (!done && s.includes(needle)) {
        done = true;
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (c) => {
      if (!done) reject(new Error(`process exited early code ${c}`));
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, timeoutMs);
  });
}

const procs = [];
function spawnBg(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  procs.push(p);
  return p;
}
function cleanup() {
  for (const p of procs) {
    try {
      p.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const proxy = spawnBg(process.execPath, [
    join(__dirname, "rpc-https-proxy.mjs"),
  ]);
  await waitFor(proxy, "rpc-https-proxy:", 8000);
  console.log("proxy up");

  // --mode test: skip basicSsl/https/proxy and load apps/staff-app/.env.test
  // so the kit points at the external :8443 proxy started above (legacy smoke
  // topology, unchanged page URL at http://127.0.0.1:5174).
  const vite = spawnBg(
    "pnpm",
    [
      "--filter",
      "staff-app",
      "dev",
      "--mode",
      "test",
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
    ],
    { cwd: ROOT },
  );
  await waitFor(vite, "Local:", 30000);
  await new Promise((r) => setTimeout(r, 1500));
  console.log("staff-app vite up");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("FAIL") || t.includes("THREW") || t.startsWith("[error]"))
      console.log("  browser:", t);
  });

  // ONE virtual authenticator for the whole context -> resident credentials
  // created on the harness page are usable on the staff-app page.
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // ---- 1. bootstrap HQ SA + staff rules + demo customer via sa-harness -----
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.saHarness, null, {
    timeout: 15000,
  });
  const hq = await page.evaluate(() =>
    window.saHarness.createWallet("dicekey HQ", "hq-admin"),
  );
  if (!hq.ok) throw new Error("HQ createWallet failed: " + JSON.stringify(hq));
  console.log("HQ SA:", hq.contractId, "root cred:", hq.credentialId);

  const sr = await page.evaluate(() =>
    window.saHarness.setupStaffRules("dicekey Staff", "bootstrap"),
  );
  if (!sr.ok) throw new Error("setupStaffRules failed: " + JSON.stringify(sr));

  const init = await page.evaluate(
    (h) => window.saHarness.initializeDicekey(h),
    hq.contractId,
  );
  if (!init.ok)
    console.log("initializeDicekey not ok:", JSON.stringify(init.results));
  const wire = await page.evaluate(
    (h) => window.saHarness.wireContracts(h),
    hq.contractId,
  );
  if (!wire.ok) console.log("wireContracts not ok:", JSON.stringify(wire.results));

  const cust = await page.evaluate(() =>
    window.saHarness.createWallet("dicekey Coffee Stamps", "demo-customer"),
  );
  if (!cust.ok)
    throw new Error("customer createWallet failed: " + JSON.stringify(cust));
  console.log("demo customer SA:", cust.contractId);

  // ---- 2-4. drive the real staff-app UI --------------------------------
  await page.goto(STAFF_URL, { waitUntil: "load" });

  // Enroll this device (HQ root authorises adding the staff signer + rules).
  await page.waitForSelector("text=この端末を登録", { timeout: 20000 });
  await page.click("text=この端末を登録");
  await page.fill(
    'input[placeholder="スタッフ名（例: 渋谷店 田中）"]',
    "渋谷店スモーク",
  );
  await page.fill(
    'input[placeholder="本部ルート credential id"]',
    hq.credentialId,
  );
  await page.click("text=この端末をスタッフ登録");

  // Enrollment success flips back to the sign-in tab.
  await page.waitForSelector("text=スタッフ passkey でサインイン", {
    timeout: 60000,
  });
  await page.selectOption("select", "shibuya");
  await page.click("text=スタッフ passkey でサインイン");

  // Logged in -> Dashboard. Go to Issue Stamp.
  await page.waitForSelector("text=スタンプ発行", { timeout: 30000 });
  await page.goto(STAFF_URL + "issue-stamp", { waitUntil: "load" });
  await page.waitForSelector('input[placeholder="顧客 SA (C...) ／ QR スキャン"]', {
    timeout: 15000,
  });
  await page.fill(
    'input[placeholder="顧客 SA (C...) ／ QR スキャン"]',
    cust.contractId,
  );
  await page.click("text=スタンプを発行（オンチェーン）");

  // ---- 5. assert success screen -----------------------------------------
  await page.waitForSelector("text=発行完了", { timeout: 90000 });
  const body = await page.evaluate(() => document.body.innerText);
  const stampMatch = body.match(/通算スタンプ:\s*(\d+)/);
  const beansMatch = body.match(/beans 残高:\s*(\d+)/);
  const stampCount = stampMatch ? Number(stampMatch[1]) : NaN;
  const beans = beansMatch ? Number(beansMatch[1]) : NaN;

  console.log("RESULT:");
  console.log("  issue success screen:", body.includes("発行完了"));
  console.log("  stamp_count:", stampCount);
  console.log("  beans:", beans);

  await browser.close();
  if (!(stampCount >= 1) || !(beans >= 10)) {
    throw new Error(
      `expected stamp_count>=1 & beans>=10, got stamp=${stampCount} beans=${beans}`,
    );
  }
  console.log("STAFF SMOKE PASS");
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => {
    console.error("STAFF SMOKE FAIL:", e && (e.stack || e.message || e));
    cleanup();
    process.exit(1);
  });
