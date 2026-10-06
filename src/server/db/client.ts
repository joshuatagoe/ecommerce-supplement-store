import pg from "pg";

// One pool per server process. In development, Next reloads modules, so the
// pool is kept on globalThis instead of opening a new one on every reload.
const cache = globalThis as unknown as { pool?: pg.Pool };

export const pool =
  cache.pool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });

if (process.env.NODE_ENV !== "production") cache.pool = pool;
