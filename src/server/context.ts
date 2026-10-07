// The Orders context for a live request or a script: the real database, the
// real clock, settings from the environment, and the email stub. Tests and the
// seed build their own, with a clock of their choosing.
import { logLinkSender } from "./adapters/log-link-sender.ts";
import { stubPayments } from "./adapters/stub-payments/index.ts";
import {
  appUrl,
  feeRateBps,
  linkSigningKey,
  linkTtlDays,
  paymentsMode,
  paymentTimeoutMs,
  stubSlowApproveMs,
  stubStorePath,
  sweepAfterMs,
} from "./config.ts";
import { db } from "./db/client.ts";
import type { OrdersContext } from "./orders/index.ts";
import type { PaymentsContext } from "./payments/index.ts";
import type { PaymentGateway } from "./ports/payment-gateway.ts";

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

/** The payment company. Only the stub exists in the slice; its test cards exist only in stub mode (§5). */
function gateway(): PaymentGateway {
  if (paymentsMode() !== "stub") throw new Error("PAYMENTS_MODE=stripe isn't built in this slice");
  const cache = globalThis as unknown as { stubGateway?: PaymentGateway };
  cache.stubGateway ??= stubPayments({
    path: stubStorePath(),
    slowApproveMs: stubSlowApproveMs(),
    // Silent cards stay silent well past our timeout.
    silenceMs: paymentTimeoutMs() * 3,
  });
  return cache.stubGateway;
}

export function paymentsContext(): PaymentsContext {
  return {
    db,
    now: () => new Date(),
    gateway: gateway(),
    paymentTimeoutMs: paymentTimeoutMs(),
    sweepAfterMs: sweepAfterMs(),
    linkSigningKey: linkSigningKey(),
  };
}
