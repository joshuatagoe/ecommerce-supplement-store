// The email stub (§3): sending a link is recorded as an audit event, and the
// provider copies the link to the patient. The event holds no link and no
// patient data, so neither reaches the audit trail or the logs (§6, §10).
import { orderEvents } from "../db/schema.ts";
import type { LinkSender } from "../ports/link-sender.ts";

export const logLinkSender: LinkSender = {
  async send(tx, message) {
    await tx.insert(orderEvents).values({
      orderId: message.orderId,
      kind: "link_sent",
      actorType: "system",
      at: message.at,
      details: { channel: "email (stub: nothing is sent)" },
    });
  },
};
