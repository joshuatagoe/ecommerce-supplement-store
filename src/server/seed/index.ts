// The demo data (PROBLEM_SPACE.md "Demo data"): two practices in different
// time zones, a margin seller and a no-profit provider, six patients each,
// eight real products whose cost is half their retail price, and about four
// months of orders made through the real code (history.ts). `npm run seed`
// runs it; Render's start command runs it with --if-empty (D54).
import { sql } from "drizzle-orm";
import { lowestPriceCents } from "../../shared/pricing/index.ts";
import type { Db } from "../db/client.ts";
import { catalogItems, patients, practices, providers, storeItems } from "../db/schema.ts";
import { CATALOG, PRACTICES } from "./demo-data.ts";
import { type HistoryProvider, seedHistory } from "./history.ts";

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
export type SeedSettings = { feeRateBps: number; linkSigningKey: string; appUrl: string; linkTtlDays: number };

export async function seedDemo(db: Db, mode: "if-empty" | "reset", settings: SeedSettings, now = new Date()): Promise<SeedResult> {
  const { feeRateBps } = settings;
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
    const history: HistoryProvider[] = [];

    for (const practice of PRACTICES) {
      const [{ id: practiceId }] = await tx
        .insert(practices)
        .values({ name: practice.name, timeZone: practice.timeZone })
        .returning({ id: practices.id });
      const patientRows = await tx
        .insert(patients)
        .values(practice.patients.map((patient) => ({ practiceId, ...patient })))
        .returning({ id: patients.id });
      const [{ id: providerId }] = await tx
        .insert(providers)
        .values({ practiceId, displayName: practice.provider.displayName })
        .returning({ id: providers.id });
      const store = await tx.insert(storeItems).values(
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
      ).returning({ catalogItemId: storeItems.catalogItemId, usualPriceCents: storeItems.usualPriceCents });
      history.push({ id: providerId, practiceId, patientIds: patientRows.map((row) => row.id), store });
    }

    await seedHistory(tx as unknown as Db, history, settings, now);
    return "seeded";
  });
}
