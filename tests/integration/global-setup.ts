import pg from "pg";
import { runMigrations } from "../../scripts/migrate";

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Run `npm run setup`, or copy .env.example to .env.");
  }
  await createDatabaseIfMissing(url);
  await runMigrations(url);
}

// A worktree's own test database (vitest.config.ts) doesn't exist until its
// first run, so it is created on the same server (D45).
async function createDatabaseIfMissing(url: string): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const server = new URL(url);
  server.pathname = "/postgres";
  const client = new pg.Client({ connectionString: server.href });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}
