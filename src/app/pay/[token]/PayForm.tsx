"use client";

// The card form (§5 step 1). A plain <form> posting to a server action, so Pay
// works before any script loads, or without one. The Pay key comes from the
// page and goes back in a hidden field; the browser never sends an amount.
import { useActionState, useId } from "react";
import { type PayFormState, payAction } from "./actions";
import { ErrorSummary } from "./ErrorSummary";
import styles from "./pay.module.css";

type Field = { name: "cardNumber" | "expiry" | "securityCode" | "zip"; path: string; label: string; hint: string; autoComplete: string };

// Tab order: card number → expiry → security code → ZIP → Pay → help (§9).
const FIELDS: Field[] = [
  { name: "cardNumber", path: "card.number", label: "Card number", hint: "The long number on the front of your card.", autoComplete: "cc-number" },
  { name: "expiry", path: "card.expiry", label: "Expiry date", hint: "MM/YY, for example 08/28.", autoComplete: "cc-exp" },
  { name: "securityCode", path: "card.securityCode", label: "Security code", hint: "3 or 4 digits, usually on the back.", autoComplete: "cc-csc" },
  { name: "zip", path: "card.zip", label: "ZIP code", hint: "The ZIP code of your billing address.", autoComplete: "postal-code" },
];

export function PayForm({ token, payKey, totalLabel }: { token: string; payKey: string; totalLabel: string }) {
  const id = useId();
  const [state, action, pending] = useActionState<PayFormState, FormData>(payAction, { payKey, errors: {}, values: {} });
  const problems = FIELDS.filter((field) => state.errors[field.path]);

  return (
    <form action={action} className={styles.form} noValidate aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Pay by card</h2>
      {problems.length > 0 && (
        <ErrorSummary
          message="Check the card details below."
          items={problems.map((field) => ({ href: `#${id}-${field.name}`, text: state.errors[field.path] }))}
        />
      )}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="payKey" value={state.payKey} />
      {FIELDS.map((field) => {
        const error = state.errors[field.path];
        return (
          <div key={field.name} className={styles.field}>
            <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
            <p id={`${id}-${field.name}-hint`} className={styles.hint}>
              {field.hint}
            </p>
            {error && (
              <p id={`${id}-${field.name}-error`} className={styles.fieldError}>
                <span className="visually-hidden">Error: </span>
                {error}
              </p>
            )}
            <input
              id={`${id}-${field.name}`}
              name={field.name}
              type="text"
              inputMode={field.name === "expiry" ? "text" : "numeric"}
              autoComplete={field.autoComplete}
              defaultValue={field.name === "securityCode" ? "" : state.values[field.name]}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-${field.name}-hint${error ? ` ${id}-${field.name}-error` : ""}`}
            />
          </div>
        );
      })}
      <button className={`button button-primary ${styles.pay}`} disabled={pending} aria-describedby={`${id}-paying`}>
        Pay {totalLabel}
      </button>
      <p id={`${id}-paying`} className={styles.paying} role="status">
        {pending ? "Taking your payment. Please keep this page open." : ""}
      </p>
    </form>
  );
}
