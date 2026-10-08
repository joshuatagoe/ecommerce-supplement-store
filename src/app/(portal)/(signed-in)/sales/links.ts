// Server only, and deliberately not in actions.ts: every export of a
// "use server" file can be called from the browser, and this signs pay links.
import { appUrl, linkSigningKey } from "@/server/config";
import { payLink } from "@/server/links";
import type { SalesResult, SalesRow, searchOrders } from "@/server/reporting";

export type SalesRowView = SalesRow & { link: string | null };
export type SalesPage = Omit<SalesResult, "rows"> & { rows: SalesRowView[] };

/** Adds each sent order's current pay link, for Copy link (§6: it works at any time). */
export function withLinks(result: Awaited<ReturnType<typeof searchOrders>>): SalesPage {
  const key = linkSigningKey();
  const base = appUrl();
  return {
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      link: row.actions.includes("copy_link") && row.linkVersion ? payLink(base, key, row.ref, row.linkVersion) : null,
    })),
  };
}
