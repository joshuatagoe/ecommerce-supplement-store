// Store and Access against real Postgres (ARCHITECTURE.md §3, §8, F1). Each
// test runs in a transaction that is rolled back.
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";
import { findProvider, listProviders } from "@/server/access/providers";
import type { Db as AppDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { listCatalog, listStoreItems, removeStoreItem, saveStoreItem } from "@/server/store";
import {
  accepted,
  catalogItem,
  type Clinic,
  type Db,
  insertInto,
  rolledBack,
  seedClinic,
  seedSentOrder,
  testPool,
} from "./fixtures";

const pool = testPool();
afterAll(() => pool.end());

const FEE = 75;

async function withClinic(body: (db: AppDb, clinic: Clinic, raw: Db) => Promise<void>) {
  await rolledBack(pool, async (raw) => {
    const clinic = await seedClinic(raw);
    await body(drizzle(raw, { schema }), clinic, raw);
  });
}

/** A second clinic with its own provider, who must never see Dr. Rivera's store. */
async function otherProvider(raw: Db): Promise<string> {
  const practice = await accepted(raw, insertInto("practices", { name: "Harbor Integrative Health", time_zone: "America/New_York" }));
  const provider = await accepted(raw, insertInto("providers", { practice_id: practice.id, display_name: "Dr. Patel" }));
  return provider.id as string;
}

describe("Access: who can sign in", () => {
  it("finds a provider with their practice", async () => {
    await withClinic(async (db, clinic) => {
      expect(await findProvider(db, clinic.providerId)).toEqual({
        id: clinic.providerId,
        displayName: "Dr. Rivera",
        practiceId: clinic.practiceId,
        practiceName: "Lakeview Family Practice",
        timeZone: "America/Los_Angeles",
      });
      expect(await listProviders(db)).toContainEqual(expect.objectContaining({ id: clinic.providerId }));
    });
  });

  it("finds no one for an unknown provider", async () => {
    await withClinic(async (db) => {
      expect(await findProvider(db, "0199b0a0-0000-7000-8000-00000000dead")).toBeNull();
    });
  });
});

describe("Store: the catalog", () => {
  it("shows each active item with its cost, lowest price and retail price", async () => {
    await withClinic(async (db, clinic, raw) => {
      await accepted(raw, insertInto("catalog_items", catalogItem({ name: "Retired item", active: false })));
      const catalog = await listCatalog(db, FEE);
      expect(catalog.find((item) => item.id === clinic.magnesiumId)).toMatchObject({
        brand: "Thorne",
        name: "Magnesium Glycinate",
        sizeLabel: "120 capsules",
        costCents: 2000,
        lowestPriceCents: 2016,
        msrpCents: 4000,
      });
      expect(catalog.map((item) => item.name)).not.toContain("Retired item");
    });
  });
});

describe("Store: saving a usual price (F1)", () => {
  it("refuses a price below the lowest, with the USERS.md message", async () => {
    await withClinic(async (db, clinic) => {
      const result = await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 2015 }, FEE);
      expect(result).toEqual({
        ok: false,
        error: {
          code: "PRICE_BELOW_LOWEST",
          message: "The lowest price for this item is $20.16. Below that you would lose money.",
          field: "usualPriceCents",
        },
      });
      expect(await listStoreItems(db, clinic.providerId, FEE)).toEqual([]);
    });
  });

  it("refuses a price above retail (D14)", async () => {
    await withClinic(async (db, clinic) => {
      const result = await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 4001 }, FEE);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PRICE_ABOVE_RETAIL", message: "The highest price is the retail price, $40.00." },
      });
    });
  });

  it("saves a price in range and returns its split, then updates it in place", async () => {
    await withClinic(async (db, clinic) => {
      const saved = await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 3600 }, FEE);
      expect(saved).toMatchObject({
        ok: true,
        item: { id: clinic.magnesiumId, usualPriceCents: 3600 },
        split: { priceCents: 3600, costCents: 2000, feeCents: 27, marginCents: 1573 },
      });
      // The bounds themselves are allowed: the no-profit price and retail.
      expect(await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 2016 }, FEE)).toMatchObject({ ok: true });
      expect(await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 4000 }, FEE)).toMatchObject({ ok: true });
      const items = await listStoreItems(db, clinic.providerId, FEE);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: clinic.magnesiumId, usualPriceCents: 4000, split: { marginCents: 1970 } });
    });
  });

  it("refuses an item that isn't in the catalog, or is no longer sold", async () => {
    await withClinic(async (db, clinic, raw) => {
      const retired = await accepted(raw, insertInto("catalog_items", catalogItem({ active: false })));
      for (const catalogItemId of [retired.id as string, "0199b0a0-0000-7000-8000-00000000dead"]) {
        expect(await saveStoreItem(db, clinic.providerId, { catalogItemId, usualPriceCents: 3000 }, FEE)).toMatchObject({
          ok: false,
          error: { code: "NOT_FOUND" },
        });
      }
    });
  });
});

describe("Store: one provider's store is theirs alone", () => {
  it("never shows another provider's items", async () => {
    await withClinic(async (db, clinic, raw) => {
      const patel = await otherProvider(raw);
      await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 3600 }, FEE);
      expect(await listStoreItems(db, patel, FEE)).toEqual([]);
      await saveStoreItem(db, patel, { catalogItemId: clinic.magnesiumId, usualPriceCents: 2016 }, FEE);
      expect((await listStoreItems(db, clinic.providerId, FEE))[0].usualPriceCents).toBe(3600);
    });
  });
});

describe("Store: removing an item (F1)", () => {
  it("removes it, and removing it again is harmless", async () => {
    await withClinic(async (db, clinic) => {
      await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 3600 }, FEE);
      expect(await removeStoreItem(db, clinic.providerId, clinic.magnesiumId)).toEqual({ ok: true });
      expect(await listStoreItems(db, clinic.providerId, FEE)).toEqual([]);
      expect(await removeStoreItem(db, clinic.providerId, clinic.magnesiumId)).toEqual({ ok: true });
    });
  });

  it("never touches an order already sent with it", async () => {
    await withClinic(async (db, clinic, raw) => {
      await saveStoreItem(db, clinic.providerId, { catalogItemId: clinic.magnesiumId, usualPriceCents: 3600 }, FEE);
      const order = await seedSentOrder(raw, clinic);
      await removeStoreItem(db, clinic.providerId, clinic.magnesiumId);
      const { rows } = await raw.query("SELECT unit_price_cents, product_name FROM order_lines WHERE order_id = $1", [order.id]);
      expect(rows).toEqual([{ unit_price_cents: 3600, product_name: "Magnesium Glycinate, 120 capsules" }]);
    });
  });
});
