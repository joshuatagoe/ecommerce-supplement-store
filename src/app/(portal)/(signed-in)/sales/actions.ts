"use server";

import { db } from "@/server/db/client";
import { searchOrders } from "@/server/reporting";
import { type ActionResult, parseInput, searchOrdersInput } from "@/shared/schemas";
import { requireProvider } from "../../session";
import { type SalesPage, withLinks } from "./links";

/**
 * §8 searchOrders. Search text arrives in the request body, never the URL,
 * and is never logged, because clinic computers are shared (§8). Only the
 * signed-in provider's orders, so only their links, come back.
 */
export async function searchOrdersAction(input: unknown): Promise<ActionResult<{ page: SalesPage }>> {
  const provider = await requireProvider();
  const parsed = parseInput(searchOrdersInput, input);
  if (!parsed.ok) return parsed;
  const result = await searchOrders({ db, now: () => new Date() }, provider, parsed.data);
  return { ok: true, page: withLinks(result) };
}
