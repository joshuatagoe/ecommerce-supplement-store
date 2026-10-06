// Backs GET /api/health (ARCHITECTURE.md §8, §11). Render sends traffic to a
// new deploy only once this reports ok, so "behind" must fail the check.
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export type Health =
  | { ok: true; db: "up"; migrations: "current" }
  | { ok: false; db: "up"; migrations: "behind" }
  | { ok: false; db: "down"; migrations: "unknown" };

type Journal = { entries: { when: number }[] };

async function latestCommittedMigration(journalPath: string): Promise<number> {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  return Math.max(0, ...journal.entries.map((entry) => entry.when));
}

// Drizzle records each applied migration's journal timestamp in created_at.
async function latestAppliedMigration(pool: Pool): Promise<number> {
  const table = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  if (table.rows[0].name === null) return 0;
  const latest = await pool.query("SELECT max(created_at)::text AS created_at FROM drizzle.__drizzle_migrations");
  return Number(latest.rows[0].created_at ?? 0);
}

export async function checkHealth(pool: Pool, journalPath: string): Promise<Health> {
  let applied: number;
  try {
    applied = await latestAppliedMigration(pool);
  } catch {
    return { ok: false, db: "down", migrations: "unknown" };
  }
  return applied >= (await latestCommittedMigration(journalPath))
    ? { ok: true, db: "up", migrations: "current" }
    : { ok: false, db: "up", migrations: "behind" };
}
