// customer-app E2E — REAL flow, no mocks.
//
// The app has no demo/guest mode: the only way in is creating a real
// passkey-backed Smart Account. This drives the kit's full WebAuthn +
// SA-deploy lifecycle through a CDP virtual authenticator against localnet,
// then asserts the Home screen reflects genuine on-chain initial state for a
// brand-new SA (0 stamps / 0 beans / empty-activity copy) and that Settings
// surfaces the deployed SA's C-address.
//
// Mirrors the proven scripts/smoke-customer-app.mjs (PASS on localnet). Fully
// self-contained: a fresh SA needs no contract initialize() (read-only
// stamp_count/balance of an unknown owner resolves to 0), so this does NOT
// depend on the staff spec's HQ bootstrap or the one-shot initialize.

import { test, expect } from "@playwright/test";
import {
  CUSTOMER_URL,
  addVirtualAuthenticator,
  pipeConsole,
} from "./fixtures";

// customer-app is a 390x844 phone layout (playwright.config viewport).
test("new passkey -> Smart Account -> Home real empty state -> Settings C-address", async ({
  browser,
}) => {
  // Self-signed proxy cert -> ignoreHTTPSErrors, same as the reference script.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  pipeConsole(page, "customer");
  await addVirtualAuthenticator(context, page);

  await page.goto(CUSTOMER_URL, { waitUntil: "load" });

  // Past the silent session-restore splash ("セッションを確認中…") to the
  // real login screen. There is NO "デモモードで試す" anymore.
  await page.waitForSelector("text=パスキーで新規作成", { timeout: 25_000 });
  await expect(page.getByText("デモモードで試す")).toHaveCount(0);

  const name = "e2e-customer";
  await page.fill('input[placeholder="お名前"]', name);
  await page.click("text=パスキーで新規作成");

  // kit.createWallet deploys the OZ smart-account contract on localnet, then
  // Home renders. The hero shows 通算来店 + a big stamp number; a fresh SA
  // must read 0 from chain.
  await page.waitForSelector("text=通算来店", { timeout: 90_000 });

  // Let the chain reads settle (loading banner -> data).
  await page.waitForFunction(
    () => !document.body.innerText.includes("チェーンから読み込み中"),
    null,
    { timeout: 30_000 },
  );

  const body = await page.evaluate(() => document.body.innerText);

  // Greeted by the entered name (real displayName, not "Demo User").
  expect(body).toContain(name);
  // No chain read error banner.
  expect(body).not.toContain("読み取りエラー");
  // Fresh SA real initial state: 0 stamps, "フィフティクラブまで あと 50",
  // and the empty-activity copy (only rendered when stampCount === 0 and no
  // badges/benefits — i.e. genuine empty on-chain holdings).
  await expect(page.getByText("通算来店")).toBeVisible();
  await expect(page.getByText("あと 50")).toBeVisible();
  await expect(
    page.getByText("まだ記録がありません。お店で来店スタンプを受け取りましょう。"),
  ).toBeVisible();

  // Settings shows the deployed Smart Account's C-address (truncated form
  // C12345...WXYZ from contractId.slice(0,6)+"..."+slice(-4)).
  await page.click('a[href="/settings"]');
  await page.waitForSelector("text=Smart Account", { timeout: 15_000 });
  const settings = await page.evaluate(() => document.body.innerText);
  expect(settings).toMatch(/C[A-Z2-7]{5}\.\.\.[A-Z2-7]{4}/);
  await expect(page.getByText("C-address")).toBeVisible();

  await context.close();
});
