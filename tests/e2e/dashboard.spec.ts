import { expect, test, type Page } from "@playwright/test";

const TEST_PASSWORD = "SwayRouter-E2E-2026";

const DASHBOARD_ROUTES = [
  ["Dashboard", "/dashboard"],
  ["API Keys", "/dashboard/manage-apikey"],
  ["Providers", "/dashboard/provider"],
  ["Combos", "/dashboard/combo"],
  ["Proxy", "/dashboard/proxy"],
  ["Usage", "/dashboard/usage"],
  ["Quota Monitor", "/dashboard/quota-monitor"],
  ["CLI Tools", "/dashboard/cli-tools"],
  ["Sway Chat", "/dashboard/sway-chat"],
  ["Settings", "/dashboard/settings"],
  ["Console Logs", "/dashboard/console-log"],
] as const;

async function expectHealthyDashboard(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Backend unavailable", { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document, `${path} must not overflow the viewport`).toBeLessThanOrEqual(
    overflow.viewport + 1,
  );

  const clippedTabs = await page.locator('main [role="tablist"]:visible').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = window.getComputedStyle(element);
      if (style.overflowX === "auto" || style.overflowX === "scroll") return [];
      return element.scrollWidth > element.clientWidth + 1
        ? [{ text: element.textContent?.trim().slice(0, 80) || "tablist" }]
        : [];
    }),
  );
  expect(clippedTabs, `${path} has a clipped non-scrollable tablist`).toEqual([]);
}

test("fresh install login and every dashboard screen work across viewport sizes", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith("http://127.0.0.1:14145/") && response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByText("Dashboard login", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Password").fill("123456");
  await page.getByRole("button", { name: "Login", exact: true }).click();

  await expect(page).toHaveURL(/\/setup$/);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Set Password & Continue" }).click();
  await expectHealthyDashboard(page, "/dashboard");

  for (const [label, path] of DASHBOARD_ROUTES) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expectHealthyDashboard(page, path);
  }

  await page.goto("/dashboard/settings?tab=data");
  await page.getByRole("button", { name: "Start migration" }).click();
  await page.getByRole("button", { name: /9Router JSON backup/ }).click();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
    name: "9router-backup-e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      settings: {},
      providerConnections: [{
        id: "e2e-import-account",
        provider: "openrouter",
        authType: "apikey",
        apiKey: "e2e-placeholder-key",
      }],
      providerNodes: [],
      proxyPools: [],
      apiKeys: [],
      combos: [],
      modelAliases: {},
      customModels: [],
      mitmAlias: null,
      pricing: {},
    })),
  });
  await page.getByRole("button", { name: "Preview migration" }).click();
  await expect(page.getByRole("heading", { name: "Migration preview" })).toBeVisible();
  await expect(page.getByText("Provider accounts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  for (const viewport of [
    { name: "ipad-pro", width: 1024, height: 1366 },
    { name: "ipad-air", width: 820, height: 1180 },
    { name: "tablet", width: 834, height: 1194 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [, path] of DASHBOARD_ROUTES) {
      await test.step(`${viewport.name}: ${path}`, async () => {
        await page.goto(path);
        await expectHealthyDashboard(page, path);
      });
    }
    await page.goto("/dashboard/settings?tab=data");
    await page.getByRole("button", { name: "Start migration" }).click();
    const migrationDialog = page.getByRole("dialog");
    await expect(migrationDialog).toBeVisible();
    const dialogOverflow = await migrationDialog.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(dialogOverflow.scroll, `${viewport.name} migration dialog must not overflow`).toBeLessThanOrEqual(
      dialogOverflow.client + 1,
    );
    await page.getByRole("button", { name: "Close" }).click();
  }

  expect(pageErrors, "uncaught browser errors").toEqual([]);
  expect(serverErrors, "local API responses with status 5xx").toEqual([]);
});
