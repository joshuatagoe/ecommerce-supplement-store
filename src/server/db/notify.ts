// Status changes are announced through Postgres NOTIFY (D24), inside the
// transaction that makes them, so a listener hears only what committed. The
// pay page's SSE stream listens on this channel (M4).
import { sql } from "drizzle-orm";
import type { Tx } from "./client.ts";

export const STATUS_CHANNEL = "order_status";

export async function notifyStatusChange(tx: Tx, ref: string): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${STATUS_CHANNEL}, ${ref})`);
}
