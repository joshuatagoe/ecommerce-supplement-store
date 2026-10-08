"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { seededPatients } from "@/server/adapters/seeded-patients";
import { requestId } from "@/app/request-id";
import { ordersContext } from "@/server/context";
import { db } from "@/server/db/client";
import { recentOrders, startOrder } from "@/server/orders";
import type { PatientMatch } from "@/server/ports/patient-directory";
import { type ActionResult, parseInput, searchPatientsInput, startOrderInput } from "@/shared/schemas";
import { requireProvider } from "../../../session";

/** §8 searchPatients: the provider's own practice only. The text is never logged or put in a URL (§10). */
export async function searchPatientsAction(input: unknown): Promise<ActionResult<{ patients: PatientMatch[] }>> {
  const provider = await requireProvider();
  const parsed = parseInput(searchPatientsInput, input);
  if (!parsed.ok) return parsed;
  return { ok: true, patients: await seededPatients(db).search(provider.practiceId, parsed.data.text) };
}

export type RecentOrderRow = { ref: string; createdAt: Date; display: string; totalCents: number | null; itemCount: number };

export async function recentOrdersAction(input: unknown): Promise<ActionResult<{ orders: RecentOrderRow[] }>> {
  const provider = await requireProvider();
  const parsed = parseInput(z.object({ patientId: z.uuid() }), input);
  if (!parsed.ok) return parsed;
  return { ok: true, orders: await recentOrders(ordersContext(await requestId()), provider, parsed.data.patientId) };
}

/** §8 startOrder, for a patient or from a past order; on success, opens the draft. */
export async function startOrderAction(input: unknown): Promise<ActionResult> {
  const provider = await requireProvider();
  const parsed = parseInput(startOrderInput, input);
  if (!parsed.ok) return parsed;
  const result = await startOrder(ordersContext(await requestId()), provider, parsed.data);
  if (!result.ok) return result;
  redirect(`/orders/${result.ref}`);
}
