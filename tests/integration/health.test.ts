import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "@/server/health";
import { currentRelease } from "@/server/release";

const JOURNAL = "drizzle/meta/_journal.json";
// Which build is answering (S1): passed in, so these tests don't depend on
// the milestone constant or on Render's environment.
const release = { milestone: "M9", commit: "abc1234" };

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
    const health = await withPool({ connectionString: testUrl() }, (pool) => checkHealth(pool, JOURNAL, release));
    expect(health).toEqual({
      ok: true,
      db: "up",
      migrations: "current",
      applied: 4,
      latest: "0003_money_core_gaps",
      ...release,
    });
  });

  it("reports migrations behind on a database that was never migrated", async () => {
    // A name of its own, so a test run in another worktree can't drop it mid-test (D45).
    const scratch = `health_unmigrated_${randomUUID().slice(0, 8)}`;
    const unmigrated = new URL(testUrl());
    unmigrated.pathname = `/${scratch}`;
    await withPool({ connectionString: testUrl() }, (admin) => admin.query(`CREATE DATABASE ${scratch}`));
    try {
      const health = await withPool({ connectionString: unmigrated.href }, (pool) => checkHealth(pool, JOURNAL, release));
      expect(health).toEqual({ ok: false, db: "up", migrations: "behind", applied: 0, latest: null, ...release });
    } finally {
      await withPool({ connectionString: testUrl() }, (admin) => admin.query(`DROP DATABASE IF EXISTS ${scratch}`));
    }
  });

  it("reports the database down when it can't connect", async () => {
    const unreachable = { connectionString: "postgres://store:store@127.0.0.1:1/none", connectionTimeoutMillis: 1000 };
    const health = await withPool(unreachable, (pool) => checkHealth(pool, JOURNAL, release));
    expect(health).toEqual({ ok: false, db: "down", migrations: "unknown", applied: null, latest: null, ...release });
  });

  it("still reports the count when the database is ahead of this build", async () => {
    // An older build, which knows only the first three migrations, against
    // the test database, which has all four (a rollback deploy).
    const journal = JSON.parse(await readFile(JOURNAL, "utf8"));
    journal.entries = journal.entries.slice(0, 3);
    const older = join(await mkdtemp(join(tmpdir(), "journal-")), "_journal.json");
    await writeFile(older, JSON.stringify(journal));
    const health = await withPool({ connectionString: testUrl() }, (pool) => checkHealth(pool, older, release));
    expect(health).toEqual({ ok: true, db: "up", migrations: "current", applied: 4, latest: null, ...release });
  });
});

describe("currentRelease", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shortens Render's commit to 7 characters", () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "c3eee65f0e1d2c3b4a5968778695a4b3c2d1e0f9");
    expect(currentRelease()).toEqual({ milestone: expect.stringMatching(/^(S1|M\d)$/), commit: "c3eee65" });
  });

  it("has no commit off Render", () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "");
    expect(currentRelease().commit).toBeNull();
  });
});
