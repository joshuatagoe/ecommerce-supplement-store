"use server";

import { revalidatePath } from "next/cache";
import { feeRateBps } from "@/server/config";
import { db } from "@/server/db/client";
import { removeStoreItem, saveStoreItem } from "@/server/store";
import { type ActionResult, parseInput, removeStoreItemInput, saveStoreItemInput } from "@/shared/schemas";
import { requireProvider } from "../../session";

/** §8 saveStoreItem: the provider comes from the session, never from the browser. */
export async function saveStoreItemAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(saveStoreItemInput, input);
  if (!parsed.ok) return parsed;
  const result = await saveStoreItem(db, provider.id, parsed.data, feeRateBps());
  if (result.ok) revalidatePath("/store");
  return result;
}

/** §8 removeStoreItem. */
export async function removeStoreItemAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(removeStoreItemInput, input);
  if (!parsed.ok) return parsed;
  const result = await removeStoreItem(db, provider.id, parsed.data.catalogItemId);
  revalidatePath("/store");
  return result;
}
