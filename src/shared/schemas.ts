// Inputs of every server action in ARCHITECTURE.md §8, checked with Zod before
// any module sees them (§10). Shared with the browser, so a form can show the
// same message the server would. Amounts are whole cents; the pay action takes
// no amount at all (§5).
import { z } from "zod";
import { DISPLAY_STATUSES } from "./status.ts";

export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNKNOWN_PROVIDER"
  | "PRICE_BELOW_LOWEST"
  | "PRICE_ABOVE_RETAIL"
  | "PATIENT_NOT_IN_PRACTICE"
  | "STORE_EMPTY"
  | "ORDER_NOT_DRAFT"
  | "QUANTITY_OUT_OF_RANGE"
  | "ITEM_NOT_IN_STORE"
  | "ORDER_EMPTY"
  | "LINES_OUT_OF_RANGE"
  | "PAYMENT_IN_PROGRESS"
  | "ORDER_NOT_SENT"
  | "ORDER_FINAL";

/** A line Send refused (LINES_OUT_OF_RANGE), so the page can mark it. */
export type LineError = { catalogItemId: string; code: ErrorCode; message: string };

/** `field` is the input's path, such as `lines.0.quantity`, so the page can mark that field. */
export type ActionError = { code: ErrorCode; message: string; field?: string; lines?: LineError[] };

/** What every server action returns (§8). */
export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ActionError };

// Order refs are 8 characters from an alphabet without 0, O, 1, I or L (§6).
const REF_BODY = "[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}";
export const REF_PATTERN = new RegExp(`^${REF_BODY}$`);
// A link token is the ref, a dot, and a 128-bit signature in base64url (D25).
export const TOKEN_PATTERN = new RegExp(`^(${REF_BODY})\\.([A-Za-z0-9_-]{22})$`);

// $100,000. Far above any retail price, and well inside a Postgres integer.
const MAX_CENTS = 10_000_000;
const RETRY = "Something went wrong. Reload the page and try again.";

const id = () => z.uuid({ error: RETRY });
const ref = () => z.string().regex(REF_PATTERN, { error: "This order reference isn't valid." });
const priceCents = () =>
  z
    .int({ error: "Enter a price in dollars and cents, like 36.00." })
    .min(0, { error: "Enter a price of $0.00 or more." })
    .max(MAX_CENTS, { error: "Enter a price under $100,000." });

export const signInInput = z.object({ providerId: id() });

export const saveStoreItemInput = z.object({ catalogItemId: id(), usualPriceCents: priceCents() });

export const removeStoreItemInput = z.object({ catalogItemId: id() });

export const searchPatientsInput = z.object({
  text: z.string().trim().max(100, { error: "Search for up to 100 characters." }),
});

export const startOrderInput = z.union(
  [z.strictObject({ patientId: id() }), z.strictObject({ fromOrderRef: ref() })],
  { error: "Choose a patient, or a past order to repeat." },
);

/** A draft line carries a price or a margin, never both (D5). */
const draftLine = z
  .object({
    catalogItemId: id(),
    quantity: z.int({ error: "Choose a quantity from 1 to 10." }).min(1, "Choose a quantity from 1 to 10.").max(10, "Choose a quantity from 1 to 10."),
    priceCents: priceCents().optional(),
    marginCents: z
      .int({ error: "Enter a margin in dollars and cents, like 15.73." })
      .min(0, { error: "Enter a margin of $0.00 or more." })
      .max(MAX_CENTS, { error: "Enter a margin under $100,000." })
      .optional(),
  })
  .refine((line) => (line.priceCents === undefined) !== (line.marginCents === undefined), {
    error: "Enter a price or a margin.",
  });

export const saveDraftInput = z.object({
  ref: ref(),
  lines: z
    .array(draftLine)
    .max(50, { error: "An order can have up to 50 products." })
    .refine((lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length, {
      error: "Each product can appear once. Change its quantity instead.",
    }),
});

/** Send, New link, Cancel order and Discard draft each take only the ref. */
export const orderRefInput = z.object({ ref: ref() });

const day = () => z.iso.date({ error: "Enter a date as YYYY-MM-DD." });

export const searchOrdersInput = z.object({
  text: z.string().trim().max(100, { error: "Search for up to 100 characters." }).optional(),
  status: z.enum(DISPLAY_STATUSES).optional(),
  dateField: z.enum(["created", "sent", "paid"]).default("created"),
  from: day().optional(),
  to: day().optional(),
  cursor: z.string().max(200).optional(),
});

/** A card stays valid through the last day of its expiry month, judged in UTC. */
function expiredBy(expiry: string, now: Date): boolean {
  const [month, year] = expiry.split("/").map(Number);
  return 2000 + year < now.getUTCFullYear() || (2000 + year === now.getUTCFullYear() && month < now.getUTCMonth() + 1);
}

/** The pay form (§8). Strict, so a request carrying an amount is refused outright. */
export function payInput(now: Date) {
  return z.strictObject({
    token: z.string().regex(TOKEN_PATTERN, { error: RETRY }),
    payKey: id(),
    card: z.strictObject({
      number: z
        .string()
        .transform((value) => value.replace(/[\s-]/g, ""))
        .pipe(z.string().regex(/^\d{13,19}$/, { error: "Enter the card number from your card." })),
      expiry: z
        .string()
        .trim()
        .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, { error: "Enter the expiry date as MM/YY." })
        .refine((expiry) => !expiredBy(expiry, now), { error: "This card has expired." }),
      securityCode: z
        .string()
        .trim()
        .regex(/^\d{3,4}$/, { error: "Enter the 3- or 4-digit security code." }),
      zip: z
        .string()
        .trim()
        .regex(/^\d{5}$/, { error: "Enter a 5-digit ZIP code." }),
    }),
  });
}

/**
 * Checks an action's input. The first problem becomes the error, with the
 * field it belongs to; a quantity problem has its own code (§8).
 */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { ok: true; data: z.output<T> } | { ok: false; error: ActionError } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const field = issue.path.join(".");
  const code: ErrorCode = issue.path.at(-1) === "quantity" ? "QUANTITY_OUT_OF_RANGE" : "INVALID_INPUT";
  return { ok: false, error: { code, message: issue.message, ...(field ? { field } : {}) } };
}
