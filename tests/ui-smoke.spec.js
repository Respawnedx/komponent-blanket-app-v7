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

async function loginThroughGate(page){
  await expect(page.locator("#authGate")).toBeVisible();
  await page.locator("#gateLoginInitials").fill(login);
  await page.locator("#gateLoginPin").fill(password);
  await page.locator("#btnGateLogin").click();

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.locator("#paper")).toBeVisible();
  await expect(page.locator("#btnLogin")).toHaveText("Log ud");
}

test("component database UI smoke test", async ({ page }) => {
  await forceLocalMode(page);
  await page.goto(process.env.UI_URL || "/");

  await loginThroughGate(page);

  await page.locator("#search").fill("1400");
  await expect(page.locator("#recordList")).toBeVisible();

  const firstRecord = page.locator(".record").first();
  if(await firstRecord.count()){
    await firstRecord.click();
    await expect(page.locator("#fMain")).not.toHaveValue("");
  }
});

test("manual project save annotates latest autosave revision", async ({ page }) => {
  test.skip(useLive, "This scenario creates data and is only run against local fallback mode.");

  await forceLocalMode(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("componentFormRecords_v1", JSON.stringify([{
      id: "seed-autosave-annotation",
      hovedkomponentnr: "990001",
      beskrivelse: "Test component",
      anlaeg: "Test plant",
      pid: "1999",
      signatur1: "TEST",
      signatur2: "2026-08-25",
      selectedCodes: [],
      codeSources: {},
      codeMeta: {},
      audit: [],
      revisions: [],
      editedBy: "TEST",
      updatedAt: "2026-08-25T00:00:00.000Z",
    }]));
  });
  await page.reload();

  await loginThroughGate(page);

  await page.locator("#search").fill("990001");
  await page.locator(".record").first().click();
  await expect(page.locator("#fMain")).toHaveValue("990001");

  await page.locator('.cb[data-code="01"]').check();
  await expect(page.locator("#syncBadge")).toContainText("Autosave gemt lokalt", { timeout: 8000 });

  await expect(page.locator(".revCard")).toHaveCount(1);
  await expect(page.locator(".revCard").first()).toContainText("Projekt reserveret");

  const dialogPromise = page.waitForEvent("dialog").then(dialog => dialog.accept());
  await page.locator("#btnSave").click();
  await page.locator("#revDesc").fill("Projekt 2026-TEST");
  await page.locator("#btnRevSave").click();
  await dialogPromise;

  await expect(page.locator(".revCard")).toHaveCount(1);
  await expect(page.locator(".revCard").first().locator(".revCard__desc")).toHaveText("Projekt 2026-TEST");
  await expect(page.locator(".revCard").first().locator(".revCard__changes")).not.toContainText("Ingen tag-ændringer");
});
