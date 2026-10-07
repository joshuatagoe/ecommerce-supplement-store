"use server";

import { randomUUID } from "node:crypto";
import { redirect, unstable_rethrow } from "next/navigation";
import { paymentsContext } from "@/server/context";
import { type PayOutcome, pay } from "@/server/payments";
import { payInput } from "@/shared/schemas";

export type PayFormState = {
  /** A fresh Pay key for the next try, so a second Pay isn't taken for a repeat of the first. */
  payKey: string;
  /** Field path → message, such as card.expiry → "This card has expired." */
  errors: Record<string, string>;
  /** What was typed, so a mistake doesn't clear the form. The security code is never sent back. */
  values: { cardNumber?: string; expiry?: string; zip?: string };
};

/**
 * §8 pay, posted by a <form>, so it works without JavaScript. It never takes
 * an amount. Every outcome reloads the page, which shows the order's state;
 * only a mistyped field comes back to the form.
 */
export async function payAction(_previous: PayFormState, form: FormData): Promise<PayFormState> {
  const token = String(form.get("token") ?? "");
  const values = {
    cardNumber: String(form.get("cardNumber") ?? ""),
    expiry: String(form.get("expiry") ?? ""),
    zip: String(form.get("zip") ?? ""),
  };
  const parsed = payInput(new Date()).safeParse({
    token,
    payKey: form.get("payKey"),
    card: {
      number: values.cardNumber,
      expiry: values.expiry,
      securityCode: String(form.get("securityCode") ?? ""),
      zip: values.zip,
    },
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      if (!field.startsWith("card.")) redirect(`/pay/${encodeURIComponent(token)}`);
      errors[field] ??= issue.message;
    }
    return { payKey: String(form.get("payKey") ?? randomUUID()), errors, values };
  }

  let outcome: PayOutcome;
  try {
    const result = await pay(paymentsContext(), parsed.data);
    if (!result.ok) {
      if (result.error.field) {
        return { payKey: parsed.data.payKey, errors: { [result.error.field]: result.error.message }, values };
      }
      // The link isn't valid: the page says so, with a 404.
      redirect(`/pay/${encodeURIComponent(token)}`);
    }
    outcome = result.outcome;
  } catch (error) {
    unstable_rethrow(error);
    // Anything unexplained shows "confirming", never "declined" (D23).
    outcome = "confirming";
  }

  const page = `/pay/${encodeURIComponent(token)}`;
  switch (outcome) {
    case "paid":
      redirect(`${page}?notice=paid`);
    case "declined":
      redirect(`${page}?notice=declined`);
    case "not_charged":
      redirect(`${page}?notice=not-charged`);
    default:
      // in_progress and confirming: the page shows "We're confirming your payment".
      redirect(page);
  }
}
