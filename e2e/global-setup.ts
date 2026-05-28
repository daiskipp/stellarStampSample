// Playwright global setup: the ONE-SHOT localnet pipeline.
//
// The dicekey contracts can only be initialize()d once per deployed instance
// (a second initialize traps `already initialized` -> UnreachableCodeReached),
// so every E2E run starts from FRESH un-initialised contracts. This setup,
// once per `pnpm test:e2e`, runs the proven pipeline:
//
//   1. scripts/deploy-localnet.sh   — `stellar contract build` (wasm32v1-none)
//      + deploy the 5 dicekey contracts, rewrite VITE_*_CONTRACT in
//      .env.localnet AND tools/sa-harness/.env (HQ/customer lines blanked).
//   2. scripts/generate-bindings.sh — regenerate @dicekey/contracts bindings
//      for the new contract ids (tail also runs `pnpm --filter
//      @dicekey/contracts build`).
//   3. Start the RPC HTTPS proxy + the 3 Vite dev servers (sa-harness:5180,
//      customer-app:5173, staff-app:5174) on the `localhost` origin (rpId
//      match). They reload .env on (re)start so they pick up the fresh
//      contract ids. They stay up for the whole run; global-teardown kills
//      them via the pids recorded in e2e/.servers.json.
//
// The actual HQ SA + staff rules + initialize + wire + customer SA bootstrap
// is intentionally NOT done here: a CDP virtual authenticator is per browser
// context, and the staff-app enrollment must reuse the HQ root resident
// credential. So that bootstrap runs inside the staff spec's own context
// (e2e/fixtures.ts#bootstrapHarness). This setup only guarantees fresh
// contracts + bindings + running servers.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVERS_FILE = join(__dirname, ".servers.json");

function run(cmd: string, args: string[], label: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[global-setup] ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

function waitForStdout(
  proc: ChildProcess,
  needle: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const onData = (d: Buffer) => {
      const s = d.toString();
      if (!done && s.includes(needle)) {
        done = true;
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (c) => {
      if (!done) reject(new Error(`${label} exited early (code ${c})`));
    });
    setTimeout(() => {
      // Vite/proxy sometimes already printed before we attached; assume up.
      if (!done) {
        done = true;
        resolve();
      }
    }, timeoutMs);
  });
}

// Free the proxy + Vite ports before (re)starting. A previously failed run
// (globalSetup threw -> globalTeardown never ran) or a manually-left dev
// server would otherwise block --strictPort. Best-effort: lsof may be absent.
function freePorts(ports: number[]) {
  for (const port of ports) {
    const r = spawnSync("bash", [
      "-c",
      `lsof -ti tcp:${port} 2>/dev/null | xargs -r kill -9 2>/dev/null || true`,
    ]);
    if (r.status !== 0 && r.status !== null) {
      // non-fatal; the strictPort bind error below would surface anyway.
    }
  }
}

async function globalSetup() {
  // 0. clear stale port holders from a prior aborted run.
  freePorts([5180, 5173, 5174, 8443]);

  // 1. fresh contracts.
  run("bash", ["scripts/deploy-localnet.sh"], "deploy-localnet");
  // 2. regenerate + compile bindings for the new ids.
  run("bash", ["scripts/generate-bindings.sh"], "generate-bindings");

  // 3. servers. Detached so global-teardown can kill the whole group.
  const pids: number[] = [];
  const procs: ChildProcess[] = [];

  const spawnBg = (cmd: string, args: string[]) => {
    const p = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });
    if (p.pid) pids.push(p.pid);
    procs.push(p);
    return p;
  };

  const proxy = spawnBg("node", ["scripts/rpc-https-proxy.mjs"]);
  await waitForStdout(proxy, "rpc-https-proxy:", 8_000, "rpc-https-proxy");
  // eslint-disable-next-line no-console
  console.log("[global-setup] rpc-https-proxy up");

  // Vite served from --host localhost so the page origin == rpId. .env per
  // app already points the kit at the https proxy.
  //
  // staff-vite is intentionally NOT started here: the staff-app reads the HQ
  // Smart Account from its baked-in .env (VITE_HQ_SMART_ACCOUNT), but that SA
  // is created at RUNTIME (passkey-derived, non-deterministic) by the staff
  // spec's own bootstrapHarness. So the staff spec writes the runtime HQ SA
  // into apps/staff-app/.env and starts staff-vite itself (see fixtures.ts
  // startStaffVite) so Vite bakes the correct HQ SA. customer-app needs no HQ
  // SA, so its server is started here.
  const harness = spawnBg("pnpm", ["--filter", "sa-harness", "dev"]);
  // --mode test: customer-app's vite.config.ts skips basicSsl/https/proxy in
  // test mode, and apps/customer-app/.env.test points the kit at the external
  // :8443 proxy started above. Keeps the legacy http://localhost:5173 +
  // :8443 RPC topology the specs were written against.
  const customer = spawnBg("pnpm", [
    "--filter",
    "customer-app",
    "dev",
    "--mode",
    "test",
    "--host",
    "localhost",
    "--port",
    "5173",
    "--strictPort",
  ]);

  await Promise.all([
    waitForStdout(harness, "Local:", 40_000, "sa-harness"),
    waitForStdout(customer, "Local:", 40_000, "customer-app"),
  ]);
  // Give Vite a beat to bind the sockets.
  await new Promise((r) => setTimeout(r, 2_500));
  // eslint-disable-next-line no-console
  console.log(
    "[global-setup] proxy + harness(5180) + customer(5173) up; staff(5174) started by the staff spec",
  );

  writeFileSync(SERVERS_FILE, JSON.stringify({ pids }, null, 2));
}

export default globalSetup;
