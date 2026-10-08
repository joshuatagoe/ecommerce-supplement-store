// A scratch database of a test file's own, for code that runs real
// transactions: Orders and Payments open and commit their own, take row locks,
// and race each other, which a test can't do inside one rolled-back
// transaction. Each test makes its own clinic, so tests in a file never share
// rows, and the database is dropped when the file ends.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { runMigrations } from "../../scripts/migrate";

export type Scratch = { url: string; pool: pg.Pool; db: Db; drop: () => Promise<void> };

export async function scratchDatabase(prefix: string): Promise<Scratch> {
  const name = `${prefix}_${randomUUID().slice(0, 8)}`;
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set");
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  await runMigrations(url.href);
  const pool = new pg.Pool({ connectionString: url.href, max: 20 });
  // DROP DATABASE … WITH (FORCE) can end a connection the pool is still closing,
  // and Postgres reports that (57P01) on the idle client. Any other error still
  // fails the run.
  pool.on("error", (error: Error & { code?: string }) => {
    if (error.code !== "57P01") throw error;
  });
  return {
    url: url.href,
    pool,
    db: drizzle(pool, { schema }),
    async drop() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: base });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

export type TestClinic = {
  practiceId: string;
  provider: { id: string; practiceId: string };
  patientId: string;
  otherPatientId: string;
  magnesiumId: string;
  omegaId: string;
  zincId: string;
};

async function one(pool: pg.Pool, text: string, values: unknown[]): Promise<string> {
  return (await pool.query(text, values)).rows[0].id;
}

/**
 * A clinic with Dr. Rivera, Sam, and three products: Magnesium ($20.00 cost,
 * $40.00 retail) and Ultimate Omega in My store, and Zinc in the catalog only.
 * A second practice holds a patient Dr. Rivera must not reach.
 */
export async function makeClinic(pool: pg.Pool): Promise<TestClinic> {
  const tag = randomUUID().slice(0, 6);
  const practiceId = await one(pool, "INSERT INTO practices (name, time_zone) VALUES ($1, 'America/Los_Angeles') RETURNING id", [`Lakeview ${tag}`]);
  const otherPracticeId = await one(pool, "INSERT INTO practices (name, time_zone) VALUES ($1, 'America/New_York') RETURNING id", [`Harbor ${tag}`]);
  const providerId = await one(pool, "INSERT INTO providers (practice_id, display_name) VALUES ($1, 'Dr. Rivera') RETURNING id", [practiceId]);
  const patient = (practice: string, first: string, last: string) =>
    one(pool, "INSERT INTO patients (practice_id, first_name, last_name, email) VALUES ($1, $2, $3, $4) RETURNING id", [
      practice,
      first,
      last,
      `${first}.${last}@example.com`.toLowerCase(),
    ]);
  const patientId = await patient(practiceId, "Sam", `Okafor${tag}`);
  const otherPatientId = await patient(otherPracticeId, "Olivia", `Martin${tag}`);
  const product = (name: string, size: string, cost: number, msrp: number) =>
    one(
      pool,
      `INSERT INTO catalog_items (brand, name, size_label, image_path, image_alt, cost_cents, msrp_cents)
       VALUES ('Test brand', $1, $2, '/products/test.svg', $1 || ', ' || $2, $3, $4) RETURNING id`,
      [name, size, cost, msrp],
    );
  const magnesiumId = await product(`Magnesium Glycinate ${tag}`, "120 capsules", 2000, 4000);
  const omegaId = await product(`Ultimate Omega ${tag}`, "60 soft gels", 1498, 2995);
  const zincId = await product(`Zinc Picolinate ${tag}`, "60 capsules", 1000, 2000);
  for (const [id, price] of [
    [magnesiumId, 3600],
    [omegaId, 2700],
  ] as const) {
    await pool.query("INSERT INTO store_items (provider_id, catalog_item_id, usual_price_cents) VALUES ($1, $2, $3)", [
      providerId,
      id,
      price,
    ]);
  }
  return {
    practiceId,
    provider: { id: providerId, practiceId },
    patientId,
    otherPatientId,
    magnesiumId,
    omegaId,
    zincId,
  };
}
