import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

// One pool per server process. In development, Next reloads modules, so the
// pool is kept on globalThis instead of opening a new one on every reload.
const cache = globalThis as unknown as { pool?: pg.Pool };

export const pool =
  cache.pool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });

if (process.env.NODE_ENV !== "production") cache.pool = pool;

/** What every module takes, so a test can pass one bound to its own rolled-back transaction. */
export type Db = NodePgDatabase<typeof schema>;

/** Inside `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const db: Db = drizzle(pool, { schema });
