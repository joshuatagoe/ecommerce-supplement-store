// Inventory (ARCHITECTURE.md §3 Stubs and seams, D84): telling our stock what
// sold. Payments calls it inside the transaction that marks an order paid, so it
// happens exactly once per paid order, whether Pay or the sweep records the
// payment. Stock is ours, one stock for every provider, not one per store; the
// warehouse system owns the counts. A real version writes an outbox row here
// and a worker sends it to that system.
import type { Tx } from "../db/client.ts";

export type SoldLine = { catalogItemId: string; name: string; quantity: number };

export type Sale = { orderId: string; ref: string; lines: SoldLine[]; at: Date };

export interface Inventory {
  recordSale(tx: Tx, sale: Sale): Promise<void>;
}
