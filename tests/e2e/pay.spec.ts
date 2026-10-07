// F3: the patient pays (USERS.md, ARCHITECTURE.md §5, §6, §16 M4). Each test
// sends a fresh order as Dr. Rivera, then opens its link in a separate browser
// context with no session, as Sam would on a phone.
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import pg from "pg";

for (const file of [".env", ".env.example"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // Try the next file.
  }
}

const PHONE = { width: 390, height: 844 };

/** Sends Sam one bottle of Magnesium Glycinate at $36.00 and returns the pay link's path. */
async function sentLink(browser: Browser): Promise<{ path: string; ref: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in as Dr. Rivera" }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await page.getByRole("combobox", { name: "Patient" }).fill("Sam");
  await page.getByRole("option", { name: "Sam Okafor" }).click();
  await page.getByRole("button", { name: "Start order for Sam Okafor" }).click();
  await page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  const link = await page.getByLabel("Pay link").inputValue();
  const ref = (await page.getByTestId("order-ref").textContent())!.trim();
  await context.close();
  return { path: new URL(link).pathname, ref };
}

/** Sam's phone: a context of its own, with no provider session. */
async function patientPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function payWith(page: Page, number: string, expiry = "12/30") {
  await page.getByLabel("Card number").fill(number);
  await page.getByLabel("Expiry date").fill(expiry);
  await page.getByLabel("Security code").fill("123");
  await page.getByLabel("ZIP code").fill("94110");
  await page.getByRole("button", { name: /^Pay \$/ }).click();
}

async function expectNoAxeViolations(page: Page) {
  // Next.js streams a dynamic page's <title> in after its content; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

async function sql(text: string, values: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

test("checkout shows the provider, the items with retail prices, and the total, but not the patient", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await expect(page).toHaveTitle(/^Pay · Lakeview Family Practice/);
  await expect(page.getByRole("heading", { name: "Recommended by Dr. Rivera", level: 1 })).toBeVisible();
  await expect(page.getByText("Demo — not a real store")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Magnesium Glycinate" });
  await expect(item.getByText("$36.00")).toBeVisible();
  // The struck-through price is read as "Retail price $40.00" (§9).
  await expect(item.getByText("Retail price $40.00")).toBeAttached();
  await expect(item.getByText("You save $4.00")).toBeVisible();
  await expect(page.getByTestId("pay-total")).toHaveText("$36.00");
  await expect(page.getByRole("button", { name: "Pay $36.00" })).toBeVisible();
  await expect(page.getByText("Sam")).toHaveCount(0);
  await expect(page.getByText("Okafor")).toHaveCount(0);
  await page.getByText("Test cards").click();
  await expect(page.getByText("4242 4242 4242 4242")).toBeVisible();
});

test("the pay page sends no Referer and stays out of search engines", async ({ browser, request }) => {
  const { path } = await sentLink(browser);
  const response = await request.get(path);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-robots-tag"]).toBe("noindex");
});

test("4242 pays, shows a receipt, and reopening the link says it's already paid", async ({ browser }) => {
  const { path, ref } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await payWith(page, "4242 4242 4242 4242");
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
  await expect(page).toHaveTitle(/^Paid · Lakeview Family Practice/);
  await expect(page.getByText(ref)).toBeVisible();
  await expect(page.getByTestId("paid-total")).toHaveText("$36.00");

  const again = await patientPage(browser, path);
  await expect(again.getByRole("heading", { name: "Already paid" })).toBeVisible();
  await expect(again.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
});

test("a declined card says nothing was charged, and another card can pay", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await payWith(page, "4000 0000 0000 0002");
  // Next.js's route announcer is a role="alert" too; this is the page's error summary.
  const error = page.getByRole("alert").filter({ hasText: "declined" });
  await expect(error).toContainText("Your card was declined. You haven't been charged. Try another card.");
  await expect(error).toBeFocused();
  await payWith(page, "4242 4242 4242 4242");
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
});

test("a card field that's wrong is explained next to it", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await payWith(page, "4242 4242 4242 4242", "01/20");
  await expect(page.getByLabel("Expiry date")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("This card has expired.").first()).toBeVisible();
  await payWith(page, "4111 1111 1111 1111");
  await expect(page.getByText("Use one of the test cards listed below.").first()).toBeVisible();
});

test("no answer, but charged (0101): confirming, then the page shows paid by itself", async ({ browser }) => {
  test.setTimeout(90_000);
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await payWith(page, "4000 0000 0000 0101");
  await expect(page.getByRole("heading", { name: "We're confirming your payment" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Don't pay again. This page updates by itself.")).toBeVisible();
  await expectNoAxeViolations(page);
  // The sweep asks the payment company, records the charge, and NOTIFY reaches this page.
  await expect(page.getByRole("heading", { name: /Thank you|Already paid/ })).toBeVisible({ timeout: 45_000 });
});

test("no answer and not charged (0200): the page says it didn't go through, and Sam can pay again", async ({ browser }) => {
  test.setTimeout(90_000);
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await payWith(page, "4000 0000 0000 0200");
  await expect(page.getByRole("heading", { name: "We're confirming your payment" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Your payment didn't go through. You haven't been charged.")).toBeVisible({ timeout: 45_000 });
  await payWith(page, "4242 4242 4242 4242");
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
});

test("a cancelled order is no longer available", async ({ browser }) => {
  const { path, ref } = await sentLink(browser);
  await sql("UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE ref = $1", [ref]);
  const page = await patientPage(browser, path);
  await expect(page.getByRole("heading", { name: "This order is no longer available" })).toBeVisible();
  await expect(page.getByText("Contact Lakeview Family Practice if you still need these items.")).toBeVisible();
  await expect(page).toHaveTitle(/^Order cancelled/);
  await expectNoAxeViolations(page);
});

test("an expired link says so", async ({ browser }) => {
  const { path, ref } = await sentLink(browser);
  await sql("UPDATE orders SET link_expires_at = now() - interval '1 day' WHERE ref = $1", [ref]);
  const page = await patientPage(browser, path);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expect(page.getByText("Contact Dr. Rivera's clinic for a new one.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("a replaced or made-up link isn't valid, and reveals nothing (404)", async ({ browser, request }) => {
  const { path, ref } = await sentLink(browser);
  // New link raises the version, so the old signature stops matching.
  await sql("UPDATE orders SET link_version = link_version + 1 WHERE ref = $1", [ref]);
  for (const bad of [path, `/pay/${ref}.AAAAAAAAAAAAAAAAAAAAAA`, "/pay/ZZZZ-ZZZZ.AAAAAAAAAAAAAAAAAAAAAA", "/pay/nonsense"]) {
    const response = await request.get(bad);
    expect(response.status()).toBe(404);
  }
  const page = await patientPage(browser, path);
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  await expect(
    page.getByText("If your provider sent you a newer link, use that one. Otherwise, contact the clinic that sent you this link."),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("axe finds no problems on checkout, an error, and a receipt", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  await expectNoAxeViolations(page);
  await payWith(page, "4000 0000 0000 0002");
  await expect(page.getByRole("alert").filter({ hasText: "declined" })).toBeVisible();
  await expectNoAxeViolations(page);
  await payWith(page, "4242 4242 4242 4242");
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("keyboard only: card number, expiry, security code, ZIP, then Pay", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const page = await patientPage(browser, path);
  const number = page.getByLabel("Card number");
  for (let i = 0; i < 40 && !(await number.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(number).toBeFocused();
  await page.keyboard.type("4242424242424242");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Expiry date")).toBeFocused();
  await page.keyboard.type("12/30");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Security code")).toBeFocused();
  await page.keyboard.type("123");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("ZIP code")).toBeFocused();
  await page.keyboard.type("94110");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Pay $36.00" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
});

test("the pay page fits a 320px-wide screen", async ({ browser }) => {
  const { path } = await sentLink(browser);
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Pay $36.00" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
