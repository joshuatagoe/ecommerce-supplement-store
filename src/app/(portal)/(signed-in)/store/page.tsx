import type { Metadata } from "next";
import { feeRateBps } from "@/server/config";
import { db } from "@/server/db/client";
import { listCatalog, listStoreItems } from "@/server/store";
import { requireProvider } from "../../session";
import { StoreEditor } from "./StoreEditor";

export const metadata: Metadata = { title: "My store" };

/** F1: the catalog, and the provider's own items with their usual prices. */
export default async function StorePage() {
  const provider = await requireProvider();
  const rate = feeRateBps();
  const [catalog, items] = await Promise.all([listCatalog(db, rate), listStoreItems(db, provider.id, rate)]);
  return <StoreEditor catalog={catalog} items={items} feeRateBps={rate} />;
}
