import { expect, test } from "@playwright/test";

test("the home page is labelled as a demo and hidden from search engines", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-robots-tag"]).toBe("noindex");
  await expect(page.getByText("Demo — not a real store")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("robots.txt disallows everything", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toMatch(/Disallow: \/\s*$/m);
});

test("the health check reports a migrated database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-robots-tag"]).toBe("noindex");
  expect(await response.json()).toMatchObject({
    ok: true,
    db: "up",
    migrations: "current",
    applied: 4,
    latest: "0003_money_core_gaps",
    milestone: expect.stringMatching(/^(S1|M\d|L\d)$/),
  });
});

test("every response carries its own request ID, for matching it to the logs (§11, L3)", async ({ request }) => {
  const first = (await request.get("/sign-in")).headers()["x-request-id"];
  const second = (await request.get("/api/health")).headers()["x-request-id"];
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(second).toMatch(/^[0-9a-f-]{36}$/);
  expect(second).not.toBe(first);
});
