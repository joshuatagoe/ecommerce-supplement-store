// The demo data (PROBLEM_SPACE.md "Demo data"): two practices in different
// time zones, a margin seller and a no-profit provider, six patients each, and
// eight real products whose cost is half their retail price. `npm run seed`
// runs it; Render's start command runs it with --if-empty (M2 grill).
import { sql } from "drizzle-orm";
import { lowestPriceCents } from "../../shared/pricing/index.ts";
import type { Db } from "../db/client.ts";
import { catalogItems, patients, practices, providers, storeItems } from "../db/schema.ts";
import { CATALOG, PRACTICES } from "./demo-data.ts";

export type SeedResult = "seeded" | "already seeded";

/** Our cost is half the retail price, rounded to the nearest cent (PROBLEM_SPACE.md). */
export function costFromRetail(msrpCents: number): number {
  return Math.round(msrpCents / 2);
}

const TABLES = [
  "order_events",
  "payment_attempts",
  "order_lines",
  "orders",
  "store_items",
  "catalog_items",
  "patients",
  "providers",
  "practices",
];

/**
 * `if-empty` leaves a database that already has a catalog alone. `reset`
 * empties every table first; the audit trail and frozen lines refuse DELETE,
 * but TRUNCATE still works for exactly this (D47).
 */
export async function seedDemo(db: Db, mode: "if-empty" | "reset", feeRateBps: number): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    // One seed at a time, so two servers starting together can't both seed.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed'))`);
    if (mode === "if-empty") {
      const existing = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM catalog_items) AS seeded`);
      if (existing.rows[0].seeded) return "already seeded";
    } else {
      await tx.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")}`));
    }

    const products = await tx
      .insert(catalogItems)
      .values(
        CATALOG.map((item) => ({
          brand: item.brand,
          name: item.name,
          sizeLabel: item.sizeLabel,
          imagePath: `/products/${item.slug}.svg`,
          imageAlt: `${item.name}, ${item.sizeLabel}`,
          costCents: costFromRetail(item.msrpCents),
          msrpCents: item.msrpCents,
        })),
      )
      .returning({ id: catalogItems.id, name: catalogItems.name, costCents: catalogItems.costCents });
    const productId = new Map(products.map((product) => [product.name, product]));

    for (const practice of PRACTICES) {
      const [{ id: practiceId }] = await tx
        .insert(practices)
        .values({ name: practice.name, timeZone: practice.timeZone })
        .returning({ id: practices.id });
      await tx.insert(patients).values(practice.patients.map((patient) => ({ practiceId, ...patient })));
      const [{ id: providerId }] = await tx
        .insert(providers)
        .values({ practiceId, displayName: practice.provider.displayName })
        .returning({ id: providers.id });
      await tx.insert(storeItems).values(
        practice.provider.store.map(({ name, usualPriceCents }) => {
          const product = productId.get(name);
          if (!product) throw new Error(`The seed's store names a product not in the catalog: ${name}`);
          return {
            providerId,
            catalogItemId: product.id,
            // "lowest" is the no-profit price (D3), worked out by Pricing.
            usualPriceCents:
              usualPriceCents === "lowest"
                ? lowestPriceCents({ costCents: product.costCents, feeRateBps })
                : usualPriceCents,
          };
        }),
      );
    }
    return "seeded";
  });
}
