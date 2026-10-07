// F4 and F5: the provider checks Sales and audits a paid order (USERS.md,
// ARCHITECTURE.md §8 "Sales list", §16 M5). Other specs add orders to Dr.
// Rivera's list as they run, so these tests find their own orders by ref.
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, name = "Dr. Rivera") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL(/\/sales$/);
}

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

/** Sends one bottle of Magnesium Glycinate at $36.00 to a patient and returns its ref and pay link. */
async function sendOrder(page: Page, typed = "Sam", patient = "Sam Okafor"): Promise<{ ref: string; link: string }> {
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await page.getByRole("combobox", { name: "Patient" }).fill(typed);
  await page.getByRole("option", { name: patient }).click();
  await page.getByRole("button", { name: `Start order for ${patient}` }).click();
  await page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`Sent to ${patient}.`)).toBeVisible();
  return { ref: (await page.getByTestId("order-ref").textContent())!.trim(), link: await page.getByLabel("Pay link").inputValue() };
}

async function payAsPatient(browser: Browser, link: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel("Card number").fill("4242424242424242");
  await page.getByLabel("Expiry date").fill("12/30");
  await page.getByLabel("Security code").fill("123");
  await page.getByLabel("ZIP code").fill("94110");
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
  await context.close();
}

function row(page: Page, ref: string) {
  return page.getByRole("row").filter({ hasText: ref });
}

test("signing in opens Sales, and a provider with no orders sees where to start", async ({ page }) => {
  await signIn(page, "Dr. Patel");
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible();
  await expect(page.getByText("No orders yet.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Start a new order" }).click();
  await expect(page.getByRole("heading", { name: "New order", level: 1 })).toBeVisible();
});

test("a paid order shows in Sales with its status, totals and Order again, and in this month's totals", async ({ page, browser }) => {
  await signIn(page);
  const before = Number((await page.getByTestId("month-count").textContent()) ?? "0");
  const { ref, link } = await sendOrder(page);
  await payAsPatient(browser, link);

  await page.getByRole("link", { name: "Sales" }).click();
  const paid = row(page, ref);
  await expect(paid.getByTestId("status-badge")).toHaveText("Paid");
  await expect(paid.getByText("$36.00")).toBeVisible();
  await expect(paid.getByText("$15.73")).toBeVisible();
  await expect(paid.getByRole("button", { name: `Order again: ${ref}` })).toBeVisible();
  await expect(page.getByTestId("month-count")).toHaveText(String(before + 1));
});

test("search finds a patient's orders, and the text never goes in the URL", async ({ page }) => {
  await signIn(page);
  const { ref } = await sendOrder(page, "Maria", "Maria Gonzalez");
  await page.getByRole("link", { name: "Sales" }).click();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.getByLabel("Search by patient or order ref").fill("gonzalez");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(row(page, ref)).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sam Okafor" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^\d+ orders?$/ })).toBeVisible();
  expect(page.url()).not.toContain("gonzalez");
  expect(requests.filter((url) => url.toLowerCase().includes("gonzalez"))).toEqual([]);
});

test("filters live in the URL, and an empty result says how to clear them", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Status").selectOption("needs_review");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=needs_review/);
  await expect(page.getByText("No orders match.")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByRole("table")).toBeVisible();
});

test("the footer adds up the paid orders in view", async ({ page, browser }) => {
  await signIn(page);
  const { link } = await sendOrder(page);
  await payAsPatient(browser, link);
  await page.goto("/sales?status=paid");
  await expect(page.getByTestId("footer-totals")).toContainText(/^Paid orders in this view: \d+ · \$[\d,]+\.\d\d · earned \$[\d,]+\.\d\d · fees \$[\d,]+\.\d\d$/);
  await page.goto("/sales?status=draft");
  await expect(page.getByTestId("footer-totals")).toHaveText("No paid orders in this view.");
});

test("Order details shows where every cent of a paid order went, and its audit trail (F5)", async ({ page, browser }) => {
  await signIn(page);
  const { ref, link } = await sendOrder(page);
  await payAsPatient(browser, link);
  await page.getByRole("link", { name: "Sales" }).click();
  await row(page, ref).getByRole("link", { name: ref }).click();

  const money = page.getByRole("table", { name: "Where the money goes" });
  const line = money.getByRole("row").filter({ hasText: "Magnesium Glycinate" });
  // Price = our cost + fee + what the provider earns: $36.00 = $20.00 + $0.27 + $15.73.
  await expect(line.getByRole("rowheader")).toContainText("Magnesium Glycinate");
  await expect(line.getByRole("cell")).toHaveText(["1", "$36.00", "$20.00", "$0.27", "$15.73"]);
  await expect(page.getByText("Fee rate: 0.75%")).toBeVisible();
  await expect(page.getByText(/^Payment reference: ch_/)).toBeVisible();
  const trail = page.getByRole("list", { name: "Audit trail" });
  await expect(trail.getByText("Draft started by Dr. Rivera")).toBeVisible();
  await expect(trail.getByText("Sent by Dr. Rivera")).toBeVisible();
  await expect(trail.getByText("Paid by the patient")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("axe finds no problems on Sales, and it fits a 320px-wide screen", async ({ page }) => {
  await signIn(page);
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("keyboard only: search Sales and open an order", async ({ page }) => {
  await signIn(page);
  const { ref } = await sendOrder(page);
  await page.getByRole("link", { name: "Sales" }).click();
  const search = page.getByLabel("Search by patient or order ref");
  for (let i = 0; i < 60 && !(await search.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await page.keyboard.type(ref);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /^1 order$/ })).toBeVisible();
  const link = page.getByRole("link", { name: ref });
  for (let i = 0; i < 60 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("order-ref")).toHaveText(ref);
});
