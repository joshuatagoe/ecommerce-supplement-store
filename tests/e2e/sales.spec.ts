// F4 and F5: the provider checks Sales and audits a paid order (USERS.md,
// ARCHITECTURE.md §8 "Sales list", §16 M5). Other specs add orders to Dr.
// Rivera's list as they run, so these tests find their own orders by ref.
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

async function sql(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

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

function shortcut(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Shortcuts" }).getByRole("link", { name });
}

const summaryNumber = async (page: Page, id: string) => Number((await page.getByTestId(id).innerText()).replace(/[^\d]/g, ""));

test("signing in opens Sales, and a provider with no orders sees where to start", async ({ page }) => {
  // The seed gives both demo providers months of orders (M6), so this test adds one with none.
  const [practice] = await sql("SELECT practice_id FROM providers WHERE display_name = 'Dr. Patel'");
  const [newcomer] = await sql("INSERT INTO providers (practice_id, display_name) VALUES ($1, 'Dr. Newcomer') RETURNING id", [
    practice.practice_id,
  ]);
  await signIn(page, "Dr. Newcomer");
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible();
  await expect(page.getByText("No orders yet.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Start a new order" }).click();
  // Dr. Newcomer's store is empty, so New order points to My store first (F1).
  await expect(page.getByRole("heading", { name: "New order", level: 1 })).toBeVisible();
  await sql("DELETE FROM providers WHERE id = $1", [newcomer.id]);
});

test("a paid order shows in Sales with its status, totals and Order again, and in Paid this month", async ({ page, browser }) => {
  await signIn(page);
  await shortcut(page, "Paid this month").click();
  const before = await summaryNumber(page, "summary-paid");
  const { ref, link } = await sendOrder(page);
  await payAsPatient(browser, link);

  await page.getByRole("link", { name: "Sales" }).click();
  const paid = row(page, ref);
  await expect(paid.getByTestId("status-badge")).toHaveText("Paid");
  await expect(paid.getByText("$36.00")).toBeVisible();
  await expect(paid.getByText("$15.73")).toBeVisible();
  await expect(paid.getByRole("button", { name: `Order again: ${ref}` })).toBeVisible();
  await shortcut(page, "Paid this month").click();
  await expect(page.getByTestId("summary-paid")).toHaveText(String(before + 1));
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
  const found = page.getByRole("status").filter({ hasText: /^\d+ orders?$/ });
  await expect(found).toBeVisible();
  // The summary follows the search too.
  await expect(page.getByTestId("summary-orders")).toHaveText((await found.innerText()).split(" ")[0]);
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

test("the summary sits above the list and adds up the paid orders in view, whatever the filters", async ({ page, browser }) => {
  await signIn(page);
  const { link } = await sendOrder(page);
  await payAsPatient(browser, link);
  await page.goto("/sales?status=paid");
  // Every order in this view is paid.
  await expect(page.getByTestId("summary-paid")).toHaveText(await page.getByTestId("summary-orders").innerText());
  await expect(page.getByTestId("summary-sales")).toHaveText(/^\$[\d,]+\.\d\d$/);
  const summary = await page.getByRole("region", { name: "Summary" }).boundingBox();
  const table = await page.getByRole("table").boundingBox();
  expect(summary!.y).toBeLessThan(table!.y);
  await page.goto("/sales?status=draft");
  await expect(page.getByTestId("summary-paid")).toHaveText("0");
  await expect(page.getByTestId("summary-sales")).toHaveText("$0.00");
});

test("shortcuts apply filters in one click, and show which one is on", async ({ page }) => {
  await signIn(page);
  await shortcut(page, "Waiting for payment").click();
  await expect(page).toHaveURL(/status=sent/);
  await expect(shortcut(page, "Waiting for payment")).toHaveAttribute("aria-current", "true");
  await expect(page.getByLabel("Status")).toHaveValue("sent");
  await expect(page.getByTestId("summary-view")).toHaveText("Waiting for payment");
  for (const badge of await page.getByTestId("status-badge").all()) await expect(badge).toHaveText("Sent");

  await shortcut(page, "Paid last month").click();
  await expect(page).toHaveURL(/status=paid&dateField=paid&from=\d{4}-\d\d-01&to=\d{4}-\d\d-\d\d/);
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("paid");
  await expect(shortcut(page, "Waiting for payment")).not.toHaveAttribute("aria-current");
});

test("the product filter lists the orders that include it, and counts its bottles sold", async ({ page, browser }) => {
  await signIn(page);
  await page.getByLabel("Product").selectOption({ label: "Magnesium Glycinate" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/product=/);
  const filtered = page.url();
  const before = await summaryNumber(page, "summary-bottles");

  const { ref, link } = await sendOrder(page);
  await payAsPatient(browser, link);
  await page.goto(filtered);
  await expect(page.getByTestId("summary-bottles")).toHaveText(String(before + 1));
  await expect(page.getByTestId("summary-view")).toContainText("Magnesium Glycinate");
  await expect(row(page, ref)).toBeVisible();
});

test("pages are numbered and kept in the URL, so Back returns to the page before", async ({ page }) => {
  // Enough old drafts for a second page, whatever the seed and earlier tests left; removed at the end.
  const [rivera] = await sql("SELECT id, practice_id FROM providers WHERE display_name = 'Dr. Rivera'");
  const [patient] = await sql("SELECT id FROM patients WHERE practice_id = $1 ORDER BY first_name LIMIT 1", [rivera.practice_id]);
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const refs = Array.from({ length: 26 }, (_, i) => `PG${String(i).padStart(2, "0")}-${tag}`);
  await sql(
    `INSERT INTO orders (ref, provider_id, practice_id, patient_id, status, created_at)
     SELECT r, $1, $2, $3, 'draft', now() - interval '400 days' FROM unnest($4::text[]) AS r`,
    [rivera.id, rivera.practice_id, patient.id, refs],
  );
  try {
    await signIn(page);
    await shortcut(page, "Drafts").click();
    const pages = page.getByRole("navigation", { name: "Pages" });
    await expect(pages).toContainText(/1–25 of \d+/);
    await pages.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(pages).toContainText(/26–\d+ of \d+/);
    await expect(pages.getByText("2", { exact: true })).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);
    await expect(pages).toContainText(/1–25 of \d+/);

    // A page past the end shows the last page.
    await page.goto("/sales?status=draft&page=999");
    await expect(pages.getByRole("link", { name: "Next" })).toHaveCount(0);
    await expect(page.getByRole("table")).toBeVisible();
  } finally {
    await sql("DELETE FROM orders WHERE ref = ANY($1::text[])", [refs]);
  }
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
