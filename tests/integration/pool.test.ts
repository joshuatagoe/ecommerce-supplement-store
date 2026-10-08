// The app's connection pool survives the database dropping a connection it
// holds idle, as happens when Postgres restarts (found in M8's load run). pg
// reports that as an "error" event on the pool; with no listener, Node would
// treat it as unhandled and stop the server.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "@/server/db/client";

const pool = createPool(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

describe("createPool", () => {
  it("logs a dropped idle connection and keeps serving queries", async () => {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
    client.release();

    // The pool's own listener, so nothing is unhandled even when no test is watching.
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    const dropped = new Promise((resolve) => pool.once("error", resolve));
    const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
    await admin.end();

    await expect(dropped).resolves.toBeInstanceOf(Error);
    expect((await pool.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
  });
});
