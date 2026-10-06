import { runMigrations } from "../../scripts/migrate";

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Run `npm run setup`, or copy .env.example to .env.");
  }
  await runMigrations(url);
}
