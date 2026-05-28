// staff-app E2E — REAL multi-sig flow, no mocks.
//
// staff-app has no demo mode: a staff member owns a passkey that is a *signer*
// on the dicekey HQ Smart Account's 3 staff CallContract rules; issuing a
// stamp is a real visit-stamps.issue(admin=HQ) tx whose 3 auth_contexts
// (issue@visit-stamps, mint@beans-token, on_stamp_issued@reward-policy) are
// resolved against those 3 rule ids (U2 case C, proven by sa-setup.mjs).
//
// ONE browser context + ONE persistent CDP virtual authenticator so the HQ
// root resident credential created via the sa-harness page is visible to the
// staff-app page (same authenticator, same rpId=localhost). This mirrors the
// proven scripts/smoke-staff-app.mjs end to end:
//
//   1. sa-harness (:5180): HQ SA + 3 staff rules + initialize 5 contracts
//      (admin=HQ) + wire visit-stamps->beans/policy + a demo customer SA.
//   2. start staff-vite (:5174) with the RUNTIME HQ SA baked into its .env
//      (staff-app reads VITE_HQ_SMART_ACCOUNT at Vite start; the SA is
//      passkey-derived so it can't be pinned ahead of time / in global-setup).
//   3. staff-app "この端末を登録" with the HQ root credential id -> a staff
//      passkey + 3 fresh staff rules on the HQ SA (HQ-root-signed).
//   4. sign in (venue=渋谷) -> kit connects to HQ SA with the staff cred.
//   5. Issue Stamp: paste the demo customer SA -> on-chain issue().
//   6. Assert the success screen: stamp_count >= 1 AND beans >= 10.
//
// The dicekey initialize() is one-shot per deployed instance and global-setup
// re-deploys fresh contracts once per run, so this test must NOT be retried
// (a retry would re-bootstrap against already-initialised contracts and trap
// `UnreachableCodeReached`). retries:0 is set on this file.

import { test, expect } from "@playwright/test";
import {
  STAFF_URL,
  addVirtualAuthenticator,
  pipeConsole,
  bootstrapHarness,
  startStaffVite,
  type StaffViteHandle,
} from "./fixtures";

// staff-app is a tablet 3-column layout — widen the viewport.
test.use({ viewport: { width: 1100, height: 800 } });
// One-shot localnet bootstrap can't be repeated — see header.
test.describe.configure({ retries: 0 });

test("enroll device -> sign in -> issue stamp on-chain -> stamp_count & beans", async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  pipeConsole(page, "staff");
  // ONE virtual authenticator for the whole context: resident credentials
  // created on the harness page are usable on the staff-app page.
  await addVirtualAuthenticator(context, page);

  let staffVite: StaffViteHandle | null = null;
  try {
    // ---- 1. bootstrap HQ SA + staff rules + initialize + wire + customer --
    const boot = await bootstrapHarness(page);
    // initialize/wire must have succeeded against the freshly deployed (un-
    // initialised) contracts; otherwise issue() will trap downstream.
    expect(boot.initOk, "sa-harness initializeDicekey").toBeTruthy();
    expect(boot.wireOk, "sa-harness wireContracts").toBeTruthy();
    expect(boot.staffRuleIds.length).toBe(3);

    // ---- 2. start staff-vite with the runtime HQ SA baked in -------------
    staffVite = await startStaffVite(boot);

    // ---- 3. staff-app: enroll THIS device (HQ root authorises the signer) -
    await page.goto(STAFF_URL, { waitUntil: "load" });
    // No demo/venue-only login — real enrollment is required first.
    await page.waitForSelector("text=この端末を登録", { timeout: 25_000 });
    await expect(page.getByText("デモモードで試す")).toHaveCount(0);
    await page.click("text=この端末を登録");
    await page.fill(
      'input[placeholder="スタッフ名（例: 渋谷店 田中）"]',
      "渋谷店 E2E",
    );
    await page.fill(
      'input[placeholder="本部ルート credential id"]',
      boot.hqCredentialId,
    );
    await page.click("text=この端末をスタッフ登録");

    // Enrollment success flips back to the sign-in tab and shows the
    // completion notice.
    await page.waitForSelector("text=端末登録完了", { timeout: 90_000 });

    // ---- 4. sign in (venue = 渋谷) ---------------------------------------
    await page.selectOption("select", "shibuya");
    await page.click("text=スタッフ passkey でサインイン");

    // Logged in -> Dashboard header. Sign-in now connects to the HQ SA with
    // the HQ ROOT credential persisted at device setup (NOT the staff cred —
    // a staff signer credential owns no SA, so passing it to
    // kit.connectWallet would trip the override at
    // .oz-build/smart-account-kit/src/kit/wallet-ops.ts:222-226). The staff
    // cred is used only at issue() time (signAndSubmit while connected as HQ),
    // the proven U2 path (scripts/sa-setup.mjs). The error matcher stays as a
    // guard so a regression surfaces the staff-app's own message instead of a
    // vague selector timeout.
    const dashboard = page.getByText("ダッシュボード");
    const signInError = page.getByText(
      /Smart account contract not found on-chain|本部 Smart Account に接続できませんでした/,
    );
    await Promise.race([
      dashboard.waitFor({ state: "visible", timeout: 40_000 }),
      signInError.waitFor({ state: "visible", timeout: 40_000 }),
    ]);
    if (await signInError.isVisible()) {
      const msg = await signInError.textContent();
      throw new Error(`staff-app sign-in failed: ${msg}`);
    }
    await page.waitForSelector("text=ダッシュボード", { timeout: 40_000 });
    await page.goto(STAFF_URL + "issue-stamp", { waitUntil: "load" });
    await page.waitForSelector(
      'input[placeholder="顧客 SA (C...) ／ QR スキャン"]',
      { timeout: 20_000 },
    );

    // ---- 5. issue to the demo customer SA --------------------------------
    await page.fill(
      'input[placeholder="顧客 SA (C...) ／ QR スキャン"]',
      boot.customerSA,
    );
    await page.click("text=スタンプを発行（オンチェーン）");

    // ---- 6. assert the on-chain success screen ---------------------------
    await page.waitForSelector("text=発行完了", { timeout: 120_000 });
    const body = await page.evaluate(() => document.body.innerText);
    const stampMatch = body.match(/通算スタンプ:\s*(\d+)/);
    const beansMatch = body.match(/beans 残高:\s*(\d+)/);
    const stampCount = stampMatch ? Number(stampMatch[1]) : NaN;
    const beans = beansMatch ? Number(beansMatch[1]) : NaN;

    // eslint-disable-next-line no-console
    console.log(`[staff] stamp_count=${stampCount} beans=${beans}`);

    expect(body).toContain("発行完了");
    expect(stampCount).toBeGreaterThanOrEqual(1);
    expect(beans).toBeGreaterThanOrEqual(10);
  } finally {
    if (staffVite) staffVite.stop();
    await context.close();
  }
});
