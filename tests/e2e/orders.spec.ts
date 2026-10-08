// F2: the provider builds an order and sends the link (USERS.md, ARCHITECTURE.md
// §16 M3). The seed is rebuilt before each run: Dr. Rivera's store has
// Magnesium Glycinate at $36.00 ($20.00 cost, $40.00 retail) and Ultimate
// Omega at $27.00; Sam Okafor is a Lakeview patient.
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

async function signIn(page: Page, name = "Dr. Rivera") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL(/\/sales$/);
}

async function choosePatient(page: Page, typed = "Sam", name = "Sam Okafor") {
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New order", level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "Patient" }).fill(typed);
  await page.getByRole("option", { name }).click();
}

/** A fresh draft for Sam with Magnesium Glycinate on it, at the usual price. */
async function draftWithMagnesium(page: Page) {
  await signIn(page);
  await choosePatient(page);
  await page.getByRole("button", { name: "Start order for Sam Okafor" }).click();
  await expect(page.getByRole("heading", { name: "New order for Sam Okafor" })).toBeVisible();
  await page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }).click();
  return line(page, "Magnesium Glycinate");
}

function line(page: Page, name: string): Locator {
  return page.getByRole("group", { name });
}

/** The quantity field itself; its stepper buttons are labelled by "Quantity" too. */
function quantity(item: Locator): Locator {
  return item.getByRole("textbox", { name: "Quantity" });
}

async function expectSaved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  // Next.js streams a dynamic page's <title> in after its content; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

async function tabTo(page: Page, target: Locator, limit = 80) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

test("the provider builds an order with live earnings, it saves itself, and Send gives a link", async ({ page }) => {
  const magnesium = await draftWithMagnesium(page);
  await expect(magnesium.getByLabel("Price per bottle")).toHaveValue("36.00");
  await expect(magnesium.getByText("You earn $15.73")).toBeVisible();

  await quantity(magnesium).fill("2");
  await quantity(magnesium).blur();
  await expect(magnesium.getByText("You earn $31.46")).toBeVisible();
  await expect(magnesium.getByText("Patient saves $8.00 vs retail")).toBeVisible();
  await expect(page.getByTestId("order-total")).toHaveText("$72.00");
  await expectSaved(page);

  // The draft saved itself: it's still there after a reload (F2, "Pulled away mid-order").
  await page.reload();
  await expect(quantity(line(page, "Magnesium Glycinate"))).toHaveValue("2");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  const link = page.getByLabel("Pay link");
  await expect(link).toHaveValue(/\/pay\/[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\.[A-Za-z0-9_-]{22}$/);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
});

test("a price out of range shows its range, and Send is disabled until it's fixed", async ({ page }) => {
  const magnesium = await draftWithMagnesium(page);
  await magnesium.getByLabel("Price per bottle").fill("20.15");
  await expect(magnesium.getByText("The lowest price for this item is $20.16. Below that you would lose money.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await magnesium.getByLabel("Price per bottle").fill("40.00");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("typing a margin finds the lowest price that earns it (D5)", async ({ page }) => {
  const magnesium = await draftWithMagnesium(page);
  // React Aria keeps the radio input visually hidden; a person clicks its label.
  await magnesium.getByText("Margin", { exact: true }).click();
  await expect(magnesium.getByRole("radio", { name: "Margin" })).toBeChecked();
  await magnesium.getByLabel("Margin per bottle").fill("15.73");
  await expect(magnesium.getByText("Price $36.00")).toBeVisible();
  await magnesium.getByLabel("Margin per bottle").fill("10.00");
  await expect(magnesium.getByText("Price $30.23")).toBeVisible();
  await expectSaved(page);
});

test("No profit and Max profit set a line's price or margin, with the fee shown", async ({ page }) => {
  const magnesium = await draftWithMagnesium(page);
  await expect(magnesium.getByText("Cost $20.00")).toBeVisible();
  await expect(magnesium.getByText("Fee $0.27")).toBeVisible();

  await magnesium.getByRole("button", { name: "No profit" }).click();
  await expect(magnesium.getByLabel("Price per bottle")).toHaveValue("20.16");
  await expect(magnesium.getByText("You earn $0.00")).toBeVisible();
  await magnesium.getByRole("button", { name: "Max profit" }).click();
  await expect(magnesium.getByLabel("Price per bottle")).toHaveValue("40.00");
  await expect(magnesium.getByText("You earn $19.70")).toBeVisible();
  await expect(magnesium.getByText("Fee $0.30")).toBeVisible();
  // Retail is allowed, so nothing blocks Send.
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

  // In margin mode the buttons set the margin those prices earn.
  await magnesium.getByText("Margin", { exact: true }).click();
  await magnesium.getByRole("button", { name: "No profit" }).click();
  await expect(magnesium.getByLabel("Margin per bottle")).toHaveValue("0.00");
  await expect(magnesium.getByText("Price $20.16")).toBeVisible();
  await magnesium.getByRole("button", { name: "Max profit" }).click();
  await expect(magnesium.getByLabel("Margin per bottle")).toHaveValue("19.70");
  await expect(magnesium.getByText("Price $40.00")).toBeVisible();
  await expectSaved(page);
});

test("New order lists recent patients before any typing, and choosing one works like a search result", async ({ page }) => {
  // A fresh draft for Sam makes him Dr. Rivera's most recent patient.
  await draftWithMagnesium(page);
  await page.getByRole("link", { name: "New order", exact: true }).click();
  const recent = page.getByRole("list", { name: "Recent patients" });
  await expect(recent.getByRole("button").first()).toHaveText("Sam Okafor");
  expect(await recent.getByRole("button").count()).toBeLessThanOrEqual(10);

  await recent.getByRole("button", { name: "Sam Okafor" }).click();
  await expect(page.getByRole("heading", { name: "Sam Okafor", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start order for Sam Okafor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent orders" })).toBeVisible();
});

test("New link replaces the link, after asking", async ({ page }) => {
  await draftWithMagnesium(page);
  await expectSaved(page);
  await page.getByRole("button", { name: "Send" }).click();
  const link = page.getByLabel("Pay link");
  const first = await link.inputValue();
  await page.getByRole("button", { name: "New link" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Make a new link?" });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "New link" }).click();
  await expect(page.getByText("New link made. The old link no longer works.")).toBeVisible();
  await expect(link).not.toHaveValue(first);
});

test("Cancel order asks first, then the order is cancelled and can be ordered again", async ({ page }) => {
  await draftWithMagnesium(page);
  await expectSaved(page);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();

  await page.getByRole("button", { name: "Cancel order" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel this order?" });
  await dialog.getByRole("button", { name: "Keep order" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByRole("alertdialog", { name: "Cancel this order?" }).getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByText("Order cancelled.")).toBeVisible();
  await expect(page.getByTestId("status-badge")).toHaveText("Cancelled");

  await page.getByRole("button", { name: "Order again" }).click();
  await expect(page.getByRole("heading", { name: "New order for Sam Okafor" })).toBeVisible();
  await expect(line(page, "Magnesium Glycinate").getByLabel("Price per bottle")).toHaveValue("36.00");
});

test("Discard draft asks first", async ({ page }) => {
  await draftWithMagnesium(page);
  await page.getByRole("button", { name: "Discard draft" }).click();
  await page.getByRole("alertdialog", { name: "Discard this draft?" }).getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByText("Draft discarded.")).toBeVisible();
});

test("the patient's recent orders offer Order again", async ({ page }) => {
  await draftWithMagnesium(page);
  await expectSaved(page);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  const ref = (await page.getByTestId("order-ref").textContent())!.trim();

  await choosePatient(page);
  const recent = page.getByRole("list", { name: "Recent orders for Sam Okafor" });
  await recent.getByRole("button", { name: `Order again: ${ref}` }).click();
  await expect(page.getByRole("heading", { name: "New order for Sam Okafor" })).toBeVisible();
  await expect(line(page, "Magnesium Glycinate")).toBeVisible();
});

test("another provider can't open Dr. Rivera's order", async ({ page }) => {
  await draftWithMagnesium(page);
  const url = page.url();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "Dr. Patel");
  const response = await page.goto(url);
  expect(response?.status()).toBe(404);
});

test("axe finds no problems on New order, a draft, and a sent order", async ({ page }) => {
  await signIn(page);
  await choosePatient(page);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Start order for Sam Okafor" }).click();
  await page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }).click();
  await line(page, "Magnesium Glycinate").getByLabel("Price per bottle").fill("1.00");
  await expect(page.getByText(/The lowest price for this item/)).toBeVisible();
  await expectNoAxeViolations(page);
  await line(page, "Magnesium Glycinate").getByLabel("Price per bottle").fill("36.00");
  await expectSaved(page);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("keyboard only: choose a patient, add an item, and send", async ({ page }) => {
  await signIn(page);
  await tabTo(page, page.getByRole("link", { name: "New order", exact: true }));
  await page.keyboard.press("Enter");
  const patient = page.getByRole("combobox", { name: "Patient" });
  await tabTo(page, patient);
  await page.keyboard.type("Sam");
  await expect(page.getByRole("option", { name: "Sam Okafor" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Start order for Sam Okafor" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "New order for Sam Okafor" })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }));
  await page.keyboard.press("Enter");
  await expectSaved(page);
  await tabTo(page, page.getByRole("button", { name: "Send" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
});

test("New order and a draft fit a 320px-wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await draftWithMagnesium(page);
  await expectSaved(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test.describe("with an empty store", () => {
  // Empties Dr. Patel's store, then rebuilds the seed so later tests start clean.
  test.afterAll(() => {
    execFileSync(process.execPath, ["--env-file-if-exists=.env", "scripts/seed.ts", "--reset"]);
  });

  test("New order sends the provider to My store first (F1)", async ({ page }) => {
    await signIn(page, "Dr. Patel");
    await page.getByRole("link", { name: "My store" }).click();
    await expect(page.getByRole("heading", { name: "My store", level: 1 })).toBeVisible();
    const remove = page.getByRole("button", { name: "Remove" });
    while ((await remove.count()) > 0) {
      const before = await remove.count();
      await remove.first().click();
      await expect(remove).toHaveCount(before - 1);
    }
    await page.getByRole("link", { name: "New order", exact: true }).click();
    await expect(page.getByText("Your store is empty. Add items in My store before you start an order.")).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "My store" }).click();
    await expect(page).toHaveURL(/\/store$/);
  });
});

test("in a contrast theme the draft's controls stay visible, and axe is clean (§9)", async ({ page }) => {
  const magnesium = await draftWithMagnesium(page);
  await page.emulateMedia({ forcedColors: "active" });
  // The chosen side of Price or Margin is underlined when the fill colour is gone.
  expect(await magnesium.getByText("Price", { exact: true }).evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain(
    "underline",
  );
  expect(await page.getByRole("button", { name: "Send" }).evaluate((el) => getComputedStyle(el).borderTopStyle)).not.toBe("none");
  await expectNoAxeViolations(page);
});
