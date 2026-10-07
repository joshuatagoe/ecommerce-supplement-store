// `npm run seed` builds the demo data (PROBLEM_SPACE.md "Demo data", M2 card).
// It runs under plain Node, as Render's start command runs it, against a
// scratch database of its own, so it also proves that the server code it
// imports loads without the bundler (D52).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPrice, lowestPriceCents } from "@/shared/pricing";
import { runMigrations } from "../../scripts/migrate";

const FEE = 75;
const scratch = `seed_${randomUUID().slice(0, 8)}`;
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
url.pathname = `/${scratch}`;
let admin: pg.Client;
let db: pg.Client;

function seed(...args: string[]): string {
  return execFileSync(process.execPath, ["scripts/seed.ts", ...args], {
    env: { ...process.env, DATABASE_URL: url.href },
    encoding: "utf8",
  });
}

async function rows(text: string): Promise<Record<string, unknown>[]> {
  return (await db.query(text)).rows;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${scratch}`);
  await runMigrations(url.href);
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
}, 30_000);

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await admin?.end();
});

describe("npm run seed", () => {
  it("seeds an empty database", () => {
    expect(seed("--if-empty")).toMatch(/Seeded/);
  }, 30_000);

  it("has two practices in different time zones, with Dr. Rivera at Lakeview Family Practice", async () => {
    const practices = await rows("SELECT name, time_zone FROM practices ORDER BY name");
    expect(practices).toHaveLength(2);
    expect(new Set(practices.map((p) => p.time_zone)).size).toBe(2);
    expect(
      await rows(
        "SELECT pr.display_name, pa.name, pa.time_zone FROM providers pr JOIN practices pa ON pa.id = pr.practice_id WHERE pr.display_name = 'Dr. Rivera'",
      ),
    ).toEqual([{ display_name: "Dr. Rivera", name: "Lakeview Family Practice", time_zone: "America/Los_Angeles" }]);
    expect(await rows("SELECT count(*)::int AS n FROM providers")).toEqual([{ n: 2 }]);
  });

  it("gives each practice about six patients, Sam among Lakeview's", async () => {
    const counts = await rows("SELECT practice_id, count(*)::int AS n FROM patients GROUP BY practice_id");
    expect(counts.map((c) => c.n)).toEqual([6, 6]);
    expect(
      await rows(
        "SELECT p.first_name FROM patients p JOIN practices pa ON pa.id = p.practice_id WHERE pa.name = 'Lakeview Family Practice' AND p.first_name = 'Sam'",
      ),
    ).toHaveLength(1);
  });

  it("stocks 8 products, each costing half its retail price, with an image and alt text", async () => {
    const items = await rows("SELECT name, size_label, image_path, image_alt, cost_cents, msrp_cents FROM catalog_items WHERE active");
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item.cost_cents, String(item.name)).toBe(Math.round(Number(item.msrp_cents) / 2));
      expect(item.image_alt).toBe(`${item.name}, ${item.size_label}`);
      expect(existsSync(join("public", String(item.image_path))), String(item.image_path)).toBe(true);
    }
  });

  it("includes the running example: Magnesium Glycinate, 120 capsules, $40.00 retail, $20.00 cost", async () => {
    expect(
      await rows("SELECT msrp_cents, cost_cents FROM catalog_items WHERE name = 'Magnesium Glycinate' AND size_label = '120 capsules'"),
    ).toEqual([{ msrp_cents: 4000, cost_cents: 2000 }]);
  });

  it("gives Dr. Rivera a store of margin prices, Magnesium at $36.00, and the other provider no-profit prices", async () => {
    const items = await rows(
      `SELECT pr.display_name, c.name, s.usual_price_cents, c.cost_cents, c.msrp_cents
         FROM store_items s JOIN providers pr ON pr.id = s.provider_id JOIN catalog_items c ON c.id = s.catalog_item_id`,
    );
    const rivera = items.filter((i) => i.display_name === "Dr. Rivera");
    const other = items.filter((i) => i.display_name !== "Dr. Rivera");
    expect(rivera.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    // Some catalog items are left out of Dr. Rivera's store, so a demo can add one.
    expect(rivera.length).toBeLessThan(8);
    expect(rivera.find((i) => i.name === "Magnesium Glycinate")?.usual_price_cents).toBe(3600);
    for (const i of items) {
      const priceCheck = checkPrice({
        priceCents: Number(i.usual_price_cents),
        costCents: Number(i.cost_cents),
        msrpCents: Number(i.msrp_cents),
        feeRateBps: FEE,
      });
      expect(priceCheck.ok, `${i.display_name}: ${i.name}`).toBe(true);
    }
    for (const i of other) {
      expect(i.usual_price_cents).toBe(lowestPriceCents({ costCents: Number(i.cost_cents), feeRateBps: FEE }));
    }
  });

  it("leaves a seeded database alone with --if-empty", async () => {
    const before = await rows("SELECT id FROM providers ORDER BY id");
    expect(seed("--if-empty")).toMatch(/already seeded/i);
    expect(await rows("SELECT id FROM providers ORDER BY id")).toEqual(before);
  }, 30_000);

  it("rebuilds everything with --reset", async () => {
    const before = await rows("SELECT id FROM providers ORDER BY id");
    await db.query("DELETE FROM store_items");
    expect(seed("--reset")).toMatch(/Seeded/);
    const after = await rows("SELECT id FROM providers ORDER BY id");
    expect(after).toHaveLength(2);
    expect(after).not.toEqual(before);
    expect((await rows("SELECT count(*)::int AS n FROM store_items"))[0].n).toBeGreaterThan(0);
    expect((await rows("SELECT count(*)::int AS n FROM catalog_items"))[0].n).toBe(8);
  }, 30_000);
});
