import { expect, test } from "@playwright/test";

const useLive = process.env.UI_USE_LIVE === "1";
const login = process.env.UI_LOGIN || (useLive ? "VIEW" : "TEST");
const password = process.env.UI_PASSWORD || "1234";

async function forceLocalMode(page){
  if(useLive) return;

  await page.route("**/*", async (route) => {
    const request = route.request();
    if(request.resourceType() !== "document"){
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: body.replace(
        /window\.COMPONENT_APP_API\s*=\s*"[^"]*";/,
        'window.COMPONENT_APP_API = "";'
      ),
      headers: {
        ...response.headers(),
        "content-type": "text/html; charset=utf-8",
      },
    });
  });
}

test("component database UI smoke test", async ({ page }) => {
  await forceLocalMode(page);
  await page.goto("/");

  await expect(page.locator("#authGate")).toBeVisible();
  await page.locator("#gateLoginInitials").fill(login);
  await page.locator("#gateLoginPin").fill(password);
  await page.locator("#btnGateLogin").click();

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator("#paper")).toBeVisible();
  await expect(page.locator("#btnLogin")).toHaveText("Log ud");

  await page.locator("#search").fill("1400");
  await expect(page.locator("#recordList")).toBeVisible();

  const firstRecord = page.locator(".record").first();
  if(await firstRecord.count()){
    await firstRecord.click();
    await expect(page.locator("#fMain")).not.toHaveValue("");
  }
});
