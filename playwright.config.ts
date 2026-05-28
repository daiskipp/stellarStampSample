import { defineConfig, devices } from "@playwright/test";

// Real-localnet + CDP-virtual-authenticator E2E.
//
// - Chromium only: the CDP WebAuthn virtual authenticator
//   (WebAuthn.addVirtualAuthenticator) is Chrome-DevTools-Protocol-specific.
// - globalSetup runs the ONE-SHOT pipeline once per run: deploy fresh
//   un-initialised contracts -> regenerate bindings -> start the RPC HTTPS
//   proxy + the 3 Vite servers (sa-harness 5180 / customer 5173 / staff 5174)
//   on the localhost origin (WebAuthn rpId match). globalTeardown kills them.
// - workers:1 — the localnet contracts are shared, single-init state; specs
//   must not run concurrently against them.
// - retries:1 — headless CDP Chromium rarely SIGSEGVs and localnet RPC has
//   occasional latency jitter; one retry absorbs that.
// - long timeouts — each test does real on-chain SA deploy + multi-context
//   passkey-signed transactions.
//
// Each spec navigates to its own app URL via e2e/fixtures.ts (no baseURL):
// customer-app is a phone viewport, staff-app overrides to a tablet viewport.

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 1,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["customer-app.spec.ts", "staff-app.spec.ts"],
    },
  ],
});
