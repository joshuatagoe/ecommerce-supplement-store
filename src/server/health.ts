// Backs GET /api/health (ARCHITECTURE.md §8, §11). Render sends traffic to a
// new deploy only once this reports ok, so "behind" must fail the check.
// It also says which build is answering (S1): how many migrations the database
// has, the newest one this build knows, the milestone, and the commit.
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { currentRelease, type Release } from "./release.ts";

type Migrations =
  | { ok: true; db: "up"; migrations: "current"; applied: number; latest: string | null }
  | { ok: false; db: "up"; migrations: "behind"; applied: number; latest: string | null }
  | { ok: false; db: "down"; migrations: "unknown"; applied: null; latest: null };

export type Health = Migrations & Release;

type Journal = { entries: { when: number; tag: string }[] };

// Drizzle records each applied migration's journal timestamp in created_at.
async function appliedMigrations(pool: Pool): Promise<{ count: number; newest: number }> {
  const table = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  if (table.rows[0].name === null) return { count: 0, newest: 0 };
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count, coalesce(max(created_at), 0)::text AS newest FROM drizzle.__drizzle_migrations",
  );
  return { count: rows[0].count, newest: Number(rows[0].newest) };
}

export async function checkHealth(pool: Pool, journalPath: string, release = currentRelease()): Promise<Health> {
  let applied: { count: number; newest: number };
  try {
    applied = await appliedMigrations(pool);
  } catch {
    return { ok: false, db: "down", migrations: "unknown", applied: null, latest: null, ...release };
  }
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const committed = Math.max(0, ...journal.entries.map((entry) => entry.when));
  // null when nothing is applied, or when the newest applied migration is one
  // this build doesn't know (a database ahead of the build).
  const latest = journal.entries.find((entry) => entry.when === applied.newest)?.tag ?? null;
  return applied.newest >= committed
    ? { ok: true, db: "up", migrations: "current", applied: applied.count, latest, ...release }
    : { ok: false, db: "up", migrations: "behind", applied: applied.count, latest, ...release };
}
