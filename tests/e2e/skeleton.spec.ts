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
  expect(await response.json()).toEqual({ ok: true, db: "up", migrations: "current" });
});
