// The scratch databases' own teardown (scratch.ts). Dropping a database WITH
// (FORCE) ends any connection still open on it, and Postgres reports that as an
// error (57P01) on the pool's idle client. With nothing listening, that one
// error failed CI's whole run after every test had passed (L1, PR #4).
import pg from "pg";
import { expect, it } from "vitest";
import { scratchDatabase } from "./scratch";

it("a scratch pool survives Postgres ending its idle connections", async () => {
  const scratch = await scratchDatabase("scratch");
  await scratch.pool.query("SELECT 1");
  expect(scratch.pool.idleCount).toBe(1);

  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [
    new URL(scratch.url).pathname.slice(1),
  ]);
  await admin.end();

  // The pool hears about it and drops the dead client instead of crashing the run.
  await expect.poll(() => scratch.pool.idleCount).toBe(0);
  await scratch.drop();
});
