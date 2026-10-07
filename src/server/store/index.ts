// Store (ARCHITECTURE.md §3): the catalog, My store, and usual prices. Every
// price is checked by Pricing; every query of a store is limited to the
// provider who owns it. Removing an item never touches a sent order, whose
// lines are frozen copies (D27).
import { and, asc, eq } from "drizzle-orm";
import { priceRangeMessage } from "../../shared/money.ts";
import { checkPrice, lowestPriceCents, type Split, unitSplit } from "../../shared/pricing/index.ts";
import type { ActionResult } from "../../shared/schemas.ts";
import type { Db } from "../db/client.ts";
import { catalogItems, storeItems } from "../db/schema.ts";

export type CatalogItem = {
  id: string;
  brand: string;
  name: string;
  sizeLabel: string;
  imagePath: string;
  imageAlt: string;
  costCents: number;
  msrpCents: number;
  lowestPriceCents: number;
};

export type StoreItem = CatalogItem & { usualPriceCents: number; split: Split };

const catalogColumns = {
  id: catalogItems.id,
  brand: catalogItems.brand,
  name: catalogItems.name,
  sizeLabel: catalogItems.sizeLabel,
  imagePath: catalogItems.imagePath,
  imageAlt: catalogItems.imageAlt,
  costCents: catalogItems.costCents,
  msrpCents: catalogItems.msrpCents,
};

type CatalogRow = Omit<CatalogItem, "lowestPriceCents">;

function withLowest(row: CatalogRow, feeRateBps: number): CatalogItem {
  return { ...row, lowestPriceCents: lowestPriceCents({ costCents: row.costCents, feeRateBps }) };
}

function toStoreItem(row: CatalogRow & { usualPriceCents: number }, feeRateBps: number): StoreItem {
  return {
    ...withLowest(row, feeRateBps),
    usualPriceCents: row.usualPriceCents,
    split: unitSplit({ priceCents: row.usualPriceCents, costCents: row.costCents, feeRateBps }),
  };
}

/** Every product we sell, with its lowest and highest allowed price (F1 step 1). */
export async function listCatalog(db: Db, feeRateBps: number): Promise<CatalogItem[]> {
  const rows = await db
    .select(catalogColumns)
    .from(catalogItems)
    .where(eq(catalogItems.active, true))
    .orderBy(asc(catalogItems.name), asc(catalogItems.brand));
  return rows.map((row) => withLowest(row, feeRateBps));
}

/** The provider's own items and usual prices. */
export async function listStoreItems(db: Db, providerId: string, feeRateBps: number): Promise<StoreItem[]> {
  const rows = await db
    .select({ ...catalogColumns, usualPriceCents: storeItems.usualPriceCents })
    .from(storeItems)
    .innerJoin(catalogItems, eq(catalogItems.id, storeItems.catalogItemId))
    .where(eq(storeItems.providerId, providerId))
    .orderBy(asc(catalogItems.name), asc(catalogItems.brand));
  return rows.map((row) => toStoreItem(row, feeRateBps));
}

/** Adds an item to My store, or changes its usual price (D16), after Pricing checks the price. */
export async function saveStoreItem(
  db: Db,
  providerId: string,
  input: { catalogItemId: string; usualPriceCents: number },
  feeRateBps: number,
): Promise<ActionResult<{ item: StoreItem; split: Split }>> {
  const [product] = await db
    .select(catalogColumns)
    .from(catalogItems)
    .where(and(eq(catalogItems.id, input.catalogItemId), eq(catalogItems.active, true)));
  if (!product) {
    return { ok: false, error: { code: "NOT_FOUND", message: "This item is no longer in the catalog." } };
  }

  const priceCheck = checkPrice({
    priceCents: input.usualPriceCents,
    costCents: product.costCents,
    msrpCents: product.msrpCents,
    feeRateBps,
  });
  if (!priceCheck.ok) {
    return {
      ok: false,
      error: { code: priceCheck.code, message: priceRangeMessage(priceCheck.code, priceCheck), field: "usualPriceCents" },
    };
  }

  await db
    .insert(storeItems)
    .values({ providerId, catalogItemId: product.id, usualPriceCents: input.usualPriceCents })
    .onConflictDoUpdate({
      target: [storeItems.providerId, storeItems.catalogItemId],
      set: { usualPriceCents: input.usualPriceCents, updatedAt: new Date() },
    });
  const item = toStoreItem({ ...product, usualPriceCents: input.usualPriceCents }, feeRateBps);
  return { ok: true, item, split: item.split };
}

/** Takes an item out of My store. Removing one that isn't there is harmless. */
export async function removeStoreItem(db: Db, providerId: string, catalogItemId: string): Promise<ActionResult> {
  await db
    .delete(storeItems)
    .where(and(eq(storeItems.providerId, providerId), eq(storeItems.catalogItemId, catalogItemId)));
  return { ok: true };
}

