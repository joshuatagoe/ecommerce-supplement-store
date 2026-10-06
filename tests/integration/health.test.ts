import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { checkHealth } from "@/server/health";

const JOURNAL = "drizzle/meta/_journal.json";

function testUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return url;
}

async function withPool<T>(config: pg.PoolConfig, query: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool(config);
  try {
    return await query(pool);
  } finally {
    await pool.end();
  }
}

describe("checkHealth", () => {
  it("is ok when the database is up and every migration is applied", async () => {
    const health = await withPool({ connectionString: testUrl() }, (pool) => checkHealth(pool, JOURNAL));
    expect(health).toEqual({ ok: true, db: "up", migrations: "current" });
  });

  it("reports migrations behind on a database that was never migrated", async () => {
    // A name of its own, so a test run in another worktree can't drop it mid-test (D45).
    const scratch = `health_unmigrated_${randomUUID().slice(0, 8)}`;
    const unmigrated = new URL(testUrl());
    unmigrated.pathname = `/${scratch}`;
    await withPool({ connectionString: testUrl() }, (admin) => admin.query(`CREATE DATABASE ${scratch}`));
    try {
      const health = await withPool({ connectionString: unmigrated.href }, (pool) => checkHealth(pool, JOURNAL));
      expect(health).toEqual({ ok: false, db: "up", migrations: "behind" });
    } finally {
      await withPool({ connectionString: testUrl() }, (admin) => admin.query(`DROP DATABASE IF EXISTS ${scratch}`));
    }
  });

  it("reports the database down when it can't connect", async () => {
    const unreachable = { connectionString: "postgres://store:store@127.0.0.1:1/none", connectionTimeoutMillis: 1000 };
    const health = await withPool(unreachable, (pool) => checkHealth(pool, JOURNAL));
    expect(health).toEqual({ ok: false, db: "down", migrations: "unknown" });
  });
});
