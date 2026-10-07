// The Orders context for a live request or a script: the real database, the
// real clock, settings from the environment, and the email stub. Tests and the
// seed build their own, with a clock of their choosing.
import { logLinkSender } from "./adapters/log-link-sender.ts";
import { appUrl, feeRateBps, linkSigningKey, linkTtlDays } from "./config.ts";
import { db } from "./db/client.ts";
import type { OrdersContext } from "./orders/index.ts";

export function ordersContext(): OrdersContext {
  return {
    db,
    now: () => new Date(),
    feeRateBps: feeRateBps(),
    linkSigningKey: linkSigningKey(),
    appUrl: appUrl(),
    linkTtlDays: linkTtlDays(),
    linkSender: logLinkSender,
  };
}
