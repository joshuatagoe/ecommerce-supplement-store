import type { Metadata } from "next";
import Link from "next/link";
import { feeRateBps } from "@/server/config";
import { ordersContext } from "@/server/context";
import { db } from "@/server/db/client";
import { recentPatients } from "@/server/orders";
import { listStoreItems } from "@/server/store";
import { requireProvider } from "../../../session";
import { NewOrder } from "./NewOrder";
import styles from "./new-order.module.css";

export const metadata: Metadata = { title: "New order" };

/** F2 step 1: choose a patient (search, or a recent one), then start an order or repeat a recent one. */
export default async function NewOrderPage() {
  const provider = await requireProvider();
  const items = await listStoreItems(db, provider.id, feeRateBps());
  if (items.length === 0) {
    return (
      <>
        <h1>New order</h1>
        <p className={styles.empty}>
          Your store is empty. Add items in <Link href="/store">My store</Link> before you start an order.
        </p>
      </>
    );
  }
  const recent = await recentPatients(ordersContext(), provider);
  return <NewOrder timeZone={provider.timeZone} recentPatients={recent} />;
}
