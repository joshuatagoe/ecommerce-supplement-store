// F1: a provider signs in and sets up My store (USERS.md, ARCHITECTURE.md §16 M2).
// The seed is rebuilt before each run (global-setup.ts): Dr. Rivera's store has
// Magnesium Glycinate at $36.00 ($20.00 cost, $40.00 retail), and some catalog
// items are left out of it.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { UnsecuredJWT } from "jose";

async function signIn(page: Page, name = "Dr. Rivera") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  // Signing in opens Sales (M5); these tests work in My store.
  await expect(page).toHaveURL(/\/sales$/);
  await page.getByRole("link", { name: "My store" }).click();
  await expect(page).toHaveURL(/\/store$/);
}

function storeItem(page: Page, name: string): Locator {
  return page.getByRole("form", { name });
}

async function expectNoAxeViolations(page: Page) {
  // Next.js streams a dynamic page's <title> in after its content; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Presses Tab until the target has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

test("a portal page without a session goes to sign-in", async ({ page }) => {
  await page.goto("/store");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a forged session is refused", async ({ page, context, baseURL }) => {
  const forged = new UnsecuredJWT({ sub: "0199b0a0-0000-7000-8000-000000000001" }).setExpirationTime("1h").encode();
  await context.addCookies([{ name: "session", value: forged, url: baseURL }]);
  await page.goto("/store");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the provider sets a usual price, sees what they earn, and saves it", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "My store", level: 1 })).toBeVisible();
  const magnesium = storeItem(page, "Magnesium Glycinate");
  await expect(magnesium.getByText("Lowest $20.16")).toBeVisible();
  await expect(magnesium.getByText("Retail $40.00")).toBeVisible();

  const price = magnesium.getByLabel("Usual price");
  await expect(price).toHaveValue("36.00");
  await price.fill("38.00");
  await expect(magnesium.getByText("You earn $17.71")).toBeVisible();
  await expect(magnesium.getByText("Patient saves $2.00 vs retail")).toBeVisible();
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(storeItem(page, "Magnesium Glycinate").getByLabel("Usual price")).toHaveValue("38.00");
  await storeItem(page, "Magnesium Glycinate").getByLabel("Usual price").fill("36.00");
  await storeItem(page, "Magnesium Glycinate").getByRole("button", { name: "Save" }).click();
  await expect(storeItem(page, "Magnesium Glycinate").getByRole("status")).toContainText("Saved");
});

test("out-of-range prices are refused with the USERS.md messages", async ({ page }) => {
  await signIn(page);
  const magnesium = storeItem(page, "Magnesium Glycinate");
  const price = magnesium.getByLabel("Usual price");

  await price.fill("20.15");
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByText("The lowest price for this item is $20.16. Below that you would lose money.")).toBeVisible();
  await expect(price).toHaveAttribute("aria-invalid", "true");

  await price.fill("40.01");
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByText("The highest price is the retail price, $40.00.")).toBeVisible();

  await page.reload();
  await expect(storeItem(page, "Magnesium Glycinate").getByLabel("Usual price")).toHaveValue("36.00");
});

test("No profit sets the lowest price", async ({ page }) => {
  await signIn(page);
  const magnesium = storeItem(page, "Magnesium Glycinate");
  await magnesium.getByRole("button", { name: "No profit" }).click();
  await expect(magnesium.getByLabel("Usual price")).toHaveValue("20.16");
  await expect(magnesium.getByText("You earn $0.00")).toBeVisible();
});

test("an added item starts at the no-profit price, and Remove takes it out", async ({ page }) => {
  await signIn(page);
  const add = page.getByRole("button", { name: /^Add .+ to My store$/ }).first();
  const name = (await add.getAttribute("aria-label"))!.replace(/^Add (.+) to My store$/, "$1");
  await add.click();

  const added = storeItem(page, name);
  await expect(added).toBeVisible();
  const lowest = (await added.getByText(/^Lowest \$/).textContent())!.replace("Lowest ", "");
  await expect(added.getByLabel("Usual price")).toHaveValue(lowest.replace("$", ""));
  await expect(added.getByText("You earn $0.00")).toBeVisible();

  await added.getByRole("button", { name: "Remove" }).click();
  await expect(added).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Add ${name} to My store` })).toBeVisible();
});

test("another provider never sees Dr. Rivera's store", async ({ page }) => {
  await signIn(page, "Dr. Patel");
  await expect(page.getByText("Dr. Patel")).toBeVisible();
  // Dr. Patel sells at no profit, so the same item shows Dr. Patel's price, not $36.00.
  await expect(storeItem(page, "Magnesium Glycinate").getByLabel("Usual price")).toHaveValue("20.16");
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/store");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("axe finds no problems on sign-in or My store", async ({ page }) => {
  await page.goto("/sign-in");
  await expectNoAxeViolations(page);
  await signIn(page);
  await expectNoAxeViolations(page);
  // The error state too.
  const magnesium = storeItem(page, "Magnesium Glycinate");
  await magnesium.getByLabel("Usual price").fill("1.00");
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByText(/The lowest price for this item/)).toBeVisible();
  await expectNoAxeViolations(page);
});

test("keyboard only: sign in, set a price and save", async ({ page }) => {
  await page.goto("/sign-in");
  await tabTo(page, page.getByRole("button", { name: "Sign in as Dr. Rivera" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sales$/);
  await tabTo(page, page.getByRole("link", { name: "My store" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/store$/);

  const magnesium = storeItem(page, "Magnesium Glycinate");
  const price = magnesium.getByLabel("Usual price");
  await tabTo(page, price);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("36.50");
  await expect(magnesium.getByText("You earn $16.22")).toBeVisible();
  await tabTo(page, magnesium.getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(magnesium.getByRole("status")).toContainText("Saved");

  await tabTo(page, magnesium.getByRole("button", { name: "No profit" }));
  await page.keyboard.press("Space");
  await expect(price).toHaveValue("20.16");
  await tabTo(page, magnesium.getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(magnesium.getByRole("status")).toContainText("Saved");
  await price.fill("36.00");
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByRole("status")).toContainText("Saved");
});

test("sign-in and My store fit a 320px-wide screen without scrolling sideways (§9)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/sign-in");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await signIn(page);
  await expect(storeItem(page, "Magnesium Glycinate")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
