#!/usr/bin/env node
// Best-effort smoke: customer-app login -> own Smart Account -> Home shows
// real localnet chain values (stamp 0 etc. for a fresh SA).
//
// Mirrors scripts/sa-setup.mjs: starts the HTTPS RPC proxy, serves
// customer-app via Vite on localhost (rpId=localhost must match the page
// origin), drives a CDP virtual WebAuthn authenticator. NOT wired into CI;
// run manually with localnet up + kit deployer (GAAH4OT3...) funded.

import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APP_URL = process.env.APP_URL || "http://localhost:5173/";

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

  // --mode test: skip basicSsl/https/proxy and load apps/customer-app/.env.test
  // so the kit points at the external :8443 proxy started above (legacy smoke
  // topology, unchanged page URL at http://127.0.0.1:5173).
  const vite = spawnBg(
    "pnpm",
    [
      "--filter",
      "customer-app",
      "dev",
      "--mode",
      "test",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
    ],
    { cwd: ROOT },
  );
  await waitFor(vite, "Local:", 30000);
  // Vite ready; give it a beat to bind.
  await new Promise((r) => setTimeout(r, 1500));
  console.log("vite up");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("error") || t.includes("Error") || t.includes("FAIL"))
      console.log("  browser:", t);
  });

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

  await page.goto(APP_URL, { waitUntil: "load" });

  // Wait past the silent-restore splash to the login screen.
  await page.waitForSelector("text=パスキーで新規作成", { timeout: 20000 });
  await page.fill('input[placeholder="お名前"]', "smoke-customer");
  await page.click("text=パスキーで新規作成");

  // After SA deploy + connect, Home renders. The hero shows 通算来店 + a big
  // stamp number; a fresh SA must read 0 from chain.
  await page.waitForSelector("text=通算来店", { timeout: 60000 });
  // Let the chain reads resolve (loading -> data).
  await page.waitForFunction(
    () => !document.body.innerText.includes("チェーンから読み込み中"),
    null,
    { timeout: 30000 },
  );

  const body = await page.evaluate(() => document.body.innerText);
  const greeted = body.includes("smoke-customer");
  const readError = body.includes("読み取りエラー");

  // Navigate to Settings via the bottom tab bar (a <Link to="/settings">).
  await page.click('a[href="/settings"]');
  await page.waitForSelector("text=Smart Account", { timeout: 10000 });
  const settings = await page.evaluate(() => document.body.innerText);
  const hasCAddr = /C[A-Z2-7]{5}\.\.\.[A-Z2-7]{4}/.test(settings);

  console.log("RESULT:");
  console.log("  Home rendered (通算来店):", true);
  console.log("  greeted by name:", greeted);
  console.log("  Home chain read error banner:", readError);
  console.log("  Settings shows SA C-address:", hasCAddr);
  console.log(
    "  Home text snippet:",
    JSON.stringify(body.slice(0, 220).replace(/\s+/g, " ")),
  );

  await browser.close();
  if (readError) throw new Error("Home showed a chain read error");
  if (!hasCAddr) throw new Error("Settings did not show a SA C-address");
  console.log("SMOKE PASS");
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => {
    console.error("SMOKE FAIL:", e.message);
    cleanup();
    process.exit(1);
  });
