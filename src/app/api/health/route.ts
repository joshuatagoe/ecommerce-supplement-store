import { join } from "node:path";
import { pool } from "@/server/db/client";
import { checkHealth } from "@/server/health";

const JOURNAL = join(process.cwd(), "drizzle", "meta", "_journal.json");

export async function GET() {
  const health = await checkHealth(pool, JOURNAL);
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
