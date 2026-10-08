// The demo video's script (Demo video card): My store → New order → the
// patient pays → where every cent went → Sales. Pauses leave room to narrate;
// DEMO_PAUSE scales them (0 for a quick check). Run with `npm run demo`.
import { type Browser, expect, type Page, test } from "@playwright/test";

const PAUSE = Number(process.env.DEMO_PAUSE ?? 1);
const beat = (page: Page, ms = 1500) => page.waitForTimeout(ms * PAUSE);

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await beat(page);
  await page.getByRole("button", { name: "Sign in as Dr. Rivera" }).click();
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible({ timeout: 90_000 });
  await beat(page, 2500);
}

/** Starts and sends an order for Sam, returning the pay link. */
async function sendOrder(page: Page): Promise<string> {
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await page.getByRole("combobox", { name: "Patient" }).pressSequentially("Sam", { delay: 120 });
  await page.getByRole("option", { name: "Sam Okafor" }).click();
  await beat(page, 2000);
  await page.getByRole("button", { name: "Start order for Sam Okafor" }).click();
  await page.getByRole("button", { name: "Add Magnesium Glycinate to this order" }).click();
  await beat(page);
  await page.getByRole("button", { name: "Add Ultimate Omega to this order" }).click();
  const omega = page.getByRole("group", { name: "Ultimate Omega" });
  // Set Omega by margin: "You earn $10.00", and Pricing finds the price (D5).
  await omega.getByText("Margin", { exact: true }).click();
  await omega.getByLabel("Margin per bottle").fill("");
  await omega.getByLabel("Margin per bottle").pressSequentially("10.00", { delay: 150 });
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await beat(page, 3000);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to Sam Okafor.")).toBeVisible();
  await beat(page, 2500);
  await page.getByRole("button", { name: "Copy link" }).click();
  await beat(page);
  return page.getByLabel("Pay link").inputValue();
}

/** Sam's phone: a context of its own, with no provider session. */
async function openAsPatient(browser: Browser, link: string): Promise<Page> {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /^Recommended by/ })).toBeVisible();
  return page;
}

async function payWith(page: Page, card: string) {
  await page.getByLabel("Card number").pressSequentially(card, { delay: 60 });
  await page.getByLabel("Expiry date").pressSequentially("1230", { delay: 80 });
  await page.getByLabel("Security code").pressSequentially("123", { delay: 80 });
  await page.getByLabel("ZIP code").pressSequentially("94110", { delay: 80 });
  await beat(page);
  await page.getByRole("button", { name: /^Pay \$/ }).click();
}

test("the main flow: My store, New order, Pay, where the money went, Sales", async ({ page, browser }) => {
  await signIn(page);

  // My store: usual prices, what the provider earns, and the allowed range (F1).
  await page.getByRole("link", { name: "My store" }).click();
  await expect(page.getByRole("heading", { name: "My store", level: 1 })).toBeVisible();
  await beat(page, 2500);
  const magnesium = page.getByRole("form", { name: "Magnesium Glycinate" });
  await magnesium.getByLabel("Usual price").fill("");
  await magnesium.getByLabel("Usual price").pressSequentially("20.15", { delay: 150 });
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByText(/The lowest price for this item is \$20\.16/)).toBeVisible();
  await beat(page, 3000);
  // Max profit fills in retail; the line under "You earn" shows the cost and fee it comes after (D78).
  await magnesium.getByRole("button", { name: "Max profit" }).click();
  await expect(magnesium.getByText("You earn $19.70")).toBeVisible();
  await beat(page, 3000);
  await magnesium.getByLabel("Usual price").fill("");
  await magnesium.getByLabel("Usual price").pressSequentially("36.00", { delay: 150 });
  await magnesium.getByRole("button", { name: "Save" }).click();
  await expect(magnesium.getByRole("status")).toContainText("Saved");
  await beat(page, 2000);

  // New order and Send (F2).
  const link = await sendOrder(page);

  // Sam pays (F3).
  const phone = await openAsPatient(browser, link);
  await beat(phone, 3000);
  await phone.getByText("Test cards").click();
  await beat(phone, 2500);
  await payWith(phone, "4242424242424242");
  await expect(phone.getByRole("heading", { name: "Thank you. Your payment went through." })).toBeVisible();
  await beat(phone, 3500);
  await phone.context().close();

  // Where every cent went (F5).
  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Paid");
  await page.getByRole("heading", { name: "Where the money goes" }).scrollIntoViewIfNeeded();
  await beat(page, 4000);
  await page.getByRole("heading", { name: "Audit trail" }).scrollIntoViewIfNeeded();
  await beat(page, 3000);

  // Sales (F4): this month's totals, the order, and the paid orders in view.
  await page.getByRole("link", { name: "Sales" }).click();
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible();
  await beat(page, 3000);
  await page.getByLabel("Status").selectOption("paid");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByTestId("footer-totals")).toContainText("Paid orders in this view");
  await page.getByTestId("footer-totals").scrollIntoViewIfNeeded();
  await beat(page, 3000);
});

test("confirming: no clear answer, then the page shows paid by itself (card 0101)", async ({ page, browser }) => {
  test.setTimeout(5 * 60_000);
  await signIn(page);
  const link = await sendOrder(page);
  const phone = await openAsPatient(browser, link);
  await payWith(phone, "4000000000000101");
  await expect(phone.getByRole("heading", { name: "We're confirming your payment" })).toBeVisible({ timeout: 30_000 });
  // The sweep asks the payment company, records the charge, and NOTIFY updates this page (§5, D24).
  await expect(phone.getByRole("heading", { name: /Thank you|Already paid/ })).toBeVisible({ timeout: 90_000 });
  await beat(phone, 3000);
});
