import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { log } from "../log.ts";
import * as schema from "./schema.ts";

/**
 * A pool that survives the database dropping an idle connection, such as on
 * a Postgres restart: pg reports that as an "error" event on the pool, and
 * with no listener Node would stop the server (found in M8's load run). The
 * dropped connection is discarded and the next query opens a new one.
 */
export function createPool(connectionString: string | undefined): pg.Pool {
  const created = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  created.on("error", (error) => log.warn({ event: "db_connection_dropped", message: error.message }));
  return created;
}

// One pool per server process. In development, Next reloads modules, so the
// pool is kept on globalThis instead of opening a new one on every reload.
const cache = globalThis as unknown as { pool?: pg.Pool };

export const pool = cache.pool ?? createPool(process.env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") cache.pool = pool;

/** What every module takes, so a test can pass one bound to its own rolled-back transaction. */
export type Db = NodePgDatabase<typeof schema>;

/** Inside `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const db: Db = drizzle(pool, { schema });
