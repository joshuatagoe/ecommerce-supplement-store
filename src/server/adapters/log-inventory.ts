// The inventory stub (§3, D84): a sale is recorded as an audit event with each
// product and quantity, and no stock is counted. The event holds no patient
// data, so nothing private reaches the audit trail.
import { orderEvents } from "../db/schema.ts";
import type { Inventory } from "../ports/inventory.ts";

export const logInventory: Inventory = {
  async recordSale(tx, sale) {
    await tx.insert(orderEvents).values({
      orderId: sale.orderId,
      kind: "inventory_updated",
      actorType: "system",
      at: sale.at,
      details: {
        system: "inventory (stub: no stock is counted)",
        items: sale.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
      },
    });
  },
};
