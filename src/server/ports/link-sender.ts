// LinkSender (ARCHITECTURE.md §3 Stubs and seams): how a pay link reaches the
// patient. It takes the open transaction, so the send is recorded with Send
// itself; a real email sender would write to an outbox there and a worker
// would send it. The subject line never contains product names.
import type { Tx } from "../db/client.ts";

export type LinkMessage = { orderId: string; ref: string; patientId: string; link: string; at: Date };

export interface LinkSender {
  send(tx: Tx, message: LinkMessage): Promise<void>;
}
