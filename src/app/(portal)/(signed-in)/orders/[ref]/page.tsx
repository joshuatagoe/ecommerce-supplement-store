import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { autosaveDebounceMs } from "@/server/config";
import { ordersContext } from "@/server/context";
import { db } from "@/server/db/client";
import { getOrder } from "@/server/orders";
import { orderAudit } from "@/server/reporting";
import { listStoreItems } from "@/server/store";
import { REF_PATTERN } from "@/shared/schemas";
import { requireProvider } from "../../../session";
import { DraftEditor } from "./DraftEditor";
import { OrderSummary } from "./OrderSummary";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ notice?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Order ${(await params).ref}` };
}

/** A draft opens in the editor (F2); anything else shows its status and actions. Another provider's order is a 404. */
export default async function OrderPage({ params, searchParams }: Props) {
  const { ref } = await params;
  if (!REF_PATTERN.test(ref)) notFound();
  const provider = await requireProvider();
  const ctx = ordersContext();
  const order = await getOrder(ctx, provider, ref);
  if (!order) notFound();

  if (order.status === "draft") {
    const storeItems = await listStoreItems(db, provider.id, ctx.feeRateBps);
    return (
      <DraftEditor
        key={order.ref}
        order={order}
        storeItems={storeItems}
        feeRateBps={ctx.feeRateBps}
        autosaveMs={autosaveDebounceMs()}
      />
    );
  }
  const { notice } = await searchParams;
  const audit = await orderAudit(ctx, provider, ref);
  return <OrderSummary order={order} audit={audit} notice={notice} timeZone={provider.timeZone} />;
}
