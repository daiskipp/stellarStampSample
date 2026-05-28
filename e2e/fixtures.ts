// Shared E2E helpers for the real-localnet + CDP-virtual-authenticator flow.
//
// The dicekey apps have NO mock/demo mode anymore: every login is a real
// passkey-backed Smart Account and every read/write hits the localnet Soroban
// RPC. So the E2E suite must, exactly like the proven scripts/sa-setup.mjs +
// scripts/smoke-*.mjs references:
//
//   1. terminate TLS in front of the plain-http localnet RPC
//      (scripts/rpc-https-proxy.mjs — smart-account-kit's @stellar/stellar-sdk
//      rpc.Server rejects plain-http and gives no allowHttp escape hatch);
//   2. serve each app from the `localhost` origin so the WebAuthn rpId
//      (VITE_RP_ID=localhost) matches the CDP virtual authenticator;
//   3. drive a CDP virtual WebAuthn authenticator so the kit's passkey flow
//      executes end-to-end headless.
//
// The one-shot pipeline (fresh un-initialised contracts -> bindings -> servers
// -> sa-harness bootstrap) is owned by global-setup.ts; this file only exposes
// the per-test browser/authenticator + sa-harness driving primitives, factored
// out of scripts/sa-setup.mjs / scripts/smoke-staff-app.mjs to avoid drift.

import { readFileSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Browser, BrowserContext, Page, CDPSession } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
export const ENV_FILE = join(ROOT, ".env.localnet");

export const CUSTOMER_URL = process.env.CUSTOMER_URL || "http://localhost:5173/";
export const STAFF_URL = process.env.STAFF_URL || "http://localhost:5174/";
export const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:5180/";

/** Read a VITE_* value out of .env.localnet (the live, deploy-rewritten env). */
export function grepEnv(key: string): string {
  const txt = readFileSync(ENV_FILE, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1].trim();
  }
  throw new Error(`${key} not in ${ENV_FILE}`);
}

/**
 * Add a CTAP2 internal virtual authenticator to a context. Resident keys + UV
 * + automatic presence so the kit's passkey create/get needs no user gesture.
 * Identical options to scripts/sa-setup.mjs (proven on localnet).
 */
export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<{ client: CDPSession; authenticatorId: string }> {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = (await client.send(
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
  )) as { authenticatorId: string };
  return { client, authenticatorId };
}

/** Forward error/warn console lines + uncaught page errors to test stdout. */
export function pipeConsole(page: Page, tag: string) {
  page.on("console", (m) => {
    const type = m.type();
    const t = m.text();
    if (
      type === "error" ||
      type === "warning" ||
      t.startsWith("[error]") ||
      t.includes("FAIL") ||
      t.includes("THREW") ||
      t.includes("Error")
    ) {
      // eslint-disable-next-line no-console
      console.log(`  [${tag}:${type}] ${t.slice(0, 400)}`);
    }
  });
  page.on("pageerror", (e) => {
    // eslint-disable-next-line no-console
    console.log(`  [${tag}:pageerror] ${String(e).slice(0, 400)}`);
  });
}

// ---- sa-harness window.saHarness driving (same shapes as sa-setup.mjs) -----

export interface HarnessWallet {
  ok: boolean;
  contractId: string;
  credentialId: string;
}

export interface SetupStaffRulesResult {
  ok: boolean;
  staffCredentialId?: string;
  contextRuleIds?: number[];
  benefitsRuleId?: number;
  error?: string;
}

export interface HarnessBootstrap {
  hqContractId: string;
  hqCredentialId: string;
  customerSA: string;
  customerCredentialId: string;
  staffRuleIds: number[];
  staffBenefitsRuleId: number;
  initOk: boolean;
  wireOk: boolean;
}

/**
 * Drive the in-browser sa-harness to the proven dicekey HQ state:
 *   HQ SA -> 3 staff CallContract rules -> initialize 5 contracts (admin=HQ)
 *   -> wire visit-stamps -> beans/policy -> a demo customer SA.
 *
 * Mirrors scripts/sa-setup.mjs steps 1,2,4,5,6 (no U2 assertion here — the
 * staff spec re-derives that through the real staff-app UI). MUST run on a
 * page whose context owns the same virtual authenticator the staff-app page
 * will use, so the HQ root resident credential is visible to enrollment.
 */
export async function bootstrapHarness(page: Page): Promise<HarnessBootstrap> {
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!(window as never as { saHarness?: unknown }).saHarness, null, {
    timeout: 20_000,
  });

  // Diagnostic: the contract id the harness Vite server actually loaded vs the
  // freshly-deployed id in .env.localnet. A mismatch => stale Vite env (the
  // server started before / didn't pick up the deploy rewrite).
  const harnessVs = (await page.evaluate(
    () =>
      (window as never as { saHarness: { _config: () => { contracts: { visitStamps: string } } } }).saHarness._config()
        .contracts.visitStamps,
  )) as string;
  let envVs = "";
  try {
    envVs = grepEnv("VITE_VISIT_STAMPS_CONTRACT");
  } catch {
    envVs = "(unreadable)";
  }
  // eslint-disable-next-line no-console
  console.log(
    `[bootstrap] harness visitStamps=${harnessVs} | .env.localnet=${envVs} | match=${harnessVs === envVs}`,
  );

  const hq = (await page.evaluate(() =>
    (window as never as { saHarness: { createWallet: (a: string, b: string) => Promise<HarnessWallet> } }).saHarness.createWallet(
      "dicekey HQ",
      "hq-admin",
    ),
  )) as HarnessWallet;
  if (!hq.ok) throw new Error("HQ createWallet failed: " + JSON.stringify(hq));

  const sr = (await page.evaluate(() =>
    (window as never as { saHarness: { setupStaffRules: (a: string, b: string) => Promise<SetupStaffRulesResult> } }).saHarness.setupStaffRules(
      "dicekey Staff",
      "bootstrap",
    ),
  )) as SetupStaffRulesResult;
  if (!sr.ok || !sr.contextRuleIds) {
    throw new Error("setupStaffRules failed: " + JSON.stringify(sr));
  }

  const init = (await page.evaluate(
    (h: string) =>
      (window as never as { saHarness: { initializeDicekey: (x: string) => Promise<{ ok: boolean; results?: unknown }> } }).saHarness.initializeDicekey(h),
    hq.contractId,
  )) as { ok: boolean; results?: unknown };
  if (!init.ok) {
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap] initializeDicekey FAILED results=${JSON.stringify(init.results)}`,
    );
  }

  const wire = (await page.evaluate(
    (h: string) =>
      (window as never as { saHarness: { wireContracts: (x: string) => Promise<{ ok: boolean; results?: unknown }> } }).saHarness.wireContracts(h),
    hq.contractId,
  )) as { ok: boolean; results?: unknown };

  const cust = (await page.evaluate(() =>
    (window as never as { saHarness: { createWallet: (a: string, b: string) => Promise<HarnessWallet> } }).saHarness.createWallet(
      "dicekey Coffee Stamps",
      "demo-customer",
    ),
  )) as HarnessWallet;
  if (!cust.ok) {
    throw new Error("customer createWallet failed: " + JSON.stringify(cust));
  }

  return {
    hqContractId: hq.contractId,
    hqCredentialId: hq.credentialId,
    customerSA: cust.contractId,
    customerCredentialId: cust.credentialId,
    staffRuleIds: sr.contextRuleIds,
    staffBenefitsRuleId: sr.benefitsRuleId ?? 0,
    initOk: init.ok,
    wireOk: wire.ok,
  };
}

// ---- staff-app Vite lifecycle (runtime-HQ-SA injection) -------------------

const STAFF_ENV = join(ROOT, "apps/staff-app/.env");

/** In-place upsert of a KEY=value line in an .env file. */
function setEnvVar(file: string, key: string, value: string) {
  let txt = readFileSync(file, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`);
  else txt = txt.replace(/\n*$/, `\n${key}=${value}\n`);
  writeFileSync(file, txt);
}

export interface StaffViteHandle {
  proc: ChildProcess;
  stop: () => void;
}

/**
 * Bake the RUNTIME bootstrap values into apps/staff-app/.env, then start the
 * staff-app Vite server so it picks them up.
 *
 * The staff-app reads the HQ Smart Account from import.meta.env
 * (VITE_HQ_SMART_ACCOUNT), baked when Vite starts. The HQ SA is created at
 * runtime by bootstrapHarness (passkey-derived, non-deterministic) and
 * deploy-localnet.sh blanks the pinned value, so staff-vite cannot start in
 * global-setup — it must start AFTER bootstrap with the runtime HQ SA pinned.
 * staffSignIn/enrollStaffDevice connect to cfg.smartAccount.hqSmartAccount, so
 * this value must be the bootstrap HQ SA. Served from --host localhost so the
 * page origin matches the WebAuthn rpId.
 */
export async function startStaffVite(
  boot: HarnessBootstrap,
): Promise<StaffViteHandle> {
  setEnvVar(STAFF_ENV, "VITE_HQ_SMART_ACCOUNT", boot.hqContractId);
  setEnvVar(
    STAFF_ENV,
    "VITE_HQ_STAFF_RULE_IDS",
    boot.staffRuleIds.join(","),
  );
  setEnvVar(
    STAFF_ENV,
    "VITE_HQ_STAFF_CONTEXT_RULE_ID",
    String(boot.staffRuleIds[0] ?? ""),
  );
  setEnvVar(
    STAFF_ENV,
    "VITE_HQ_STAFF_BENEFITS_RULE_ID",
    String(boot.staffBenefitsRuleId || ""),
  );
  setEnvVar(STAFF_ENV, "VITE_DEMO_CUSTOMER_SA", boot.customerSA);

  // --mode test: staff-app's vite.config.ts skips basicSsl/https/proxy in test
  // mode, and apps/staff-app/.env.test points the kit at the external :8443
  // proxy started by global-setup. Keeps the legacy http://localhost:5174 +
  // :8443 RPC topology the staff spec was written against.
  const proc = spawn(
    "pnpm",
    [
      "--filter",
      "staff-app",
      "dev",
      "--mode",
      "test",
      "--host",
      "localhost",
      "--port",
      "5174",
      "--strictPort",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const onData = (d: Buffer) => {
      if (!done && d.toString().includes("Local:")) {
        done = true;
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (c) => {
      if (!done) reject(new Error(`staff-vite exited early (code ${c})`));
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, 40_000);
  });
  // Let Vite bind the socket.
  await new Promise((r) => setTimeout(r, 2_500));

  return {
    proc,
    stop: () => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    },
  };
}

export type { Browser, BrowserContext, Page, CDPSession };
