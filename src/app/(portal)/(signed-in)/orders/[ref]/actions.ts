"use server";

import { redirect } from "next/navigation";
import { requestId } from "@/app/request-id";
import { ordersContext } from "@/server/context";
import { cancelOrder, newLink, type SavedLine, saveDraft, sendOrder, startOrder } from "@/server/orders";
import type { Split } from "@/shared/pricing";
import { type ActionResult, orderRefInput, parseInput, saveDraftInput } from "@/shared/schemas";
import { requireProvider } from "../../../session";

/** §8 saveDraft (autosave). */
export async function saveDraftAction(input: unknown): Promise<ActionResult<{ lines: SavedLine[]; totals: Split }>> {
  const provider = await requireProvider();
  const parsed = parseInput(saveDraftInput, input);
  if (!parsed.ok) return parsed;
  return saveDraft(ordersContext(await requestId()), provider, parsed.data);
}

/** §8 sendOrder; on success the page shows "Sent to Sam" with the link. */
export async function sendOrderAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(orderRefInput, input);
  if (!parsed.ok) return parsed;
  const result = await sendOrder(ordersContext(await requestId()), provider, parsed.data.ref);
  if (!result.ok) return result;
  redirect(`/orders/${parsed.data.ref}?notice=sent`);
}

export async function newLinkAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(orderRefInput, input);
  if (!parsed.ok) return parsed;
  const result = await newLink(ordersContext(await requestId()), provider, parsed.data.ref);
  if (!result.ok) return result;
  redirect(`/orders/${parsed.data.ref}?notice=new-link`);
}

/** Cancel order on a sent order, Discard draft on a draft: the same §8 action, with each one's own word. */
export async function cancelOrderAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(orderRefInput, input);
  if (!parsed.ok) return parsed;
  const ctx = ordersContext(await requestId());
  const result = await cancelOrder(ctx, provider, parsed.data.ref);
  if (!result.ok) return result;
  redirect(`/orders/${parsed.data.ref}?notice=cancelled`);
}

export async function discardDraftAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(orderRefInput, input);
  if (!parsed.ok) return parsed;
  const result = await cancelOrder(ordersContext(await requestId()), provider, parsed.data.ref);
  if (!result.ok) return result;
  redirect(`/orders/${parsed.data.ref}?notice=discarded`);
}

/** Order again (D31): a new draft with the same items, quantities and prices. */
export async function orderAgainAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(orderRefInput, input);
  if (!parsed.ok) return parsed;
  const result = await startOrder(ordersContext(await requestId()), provider, { fromOrderRef: parsed.data.ref });
  if (!result.ok) return result;
  redirect(`/orders/${result.ref}`);
}
