// The stub payment company (ARCHITECTURE.md §5 "Test cards", D38). The card
// number picks the outcome, the way Stripe's test mode does. It keeps its
// records in its own JSON file, never in our database, so stopping our
// database doesn't wipe its memory. It's wired in only when PAYMENTS_MODE=stub.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChargeAnswer, LookupAnswer, PaymentGateway } from "../../ports/payment-gateway.ts";

type Behaviour = "approve" | "decline" | "charge-then-silent" | "silent" | "slow-approve";

export const TEST_CARDS: Record<string, { behaviour: Behaviour; shows: string }> = {
  "4242424242424242": { behaviour: "approve", shows: "Approves at once" },
  "4000000000000002": { behaviour: "decline", shows: "Declines at once" },
  "4000000000000101": { behaviour: "charge-then-silent", shows: "Charges, then never answers: confirming, then paid" },
  "4000000000000200": { behaviour: "silent", shows: "Never answers and doesn't charge: confirming, then try again" },
  "4000000000000309": { behaviour: "slow-approve", shows: "Charges, then approves after a pause" },
};

type Record_ = { status: "charged" | "declined"; chargeRef?: string; amountCents: number; at: string };
type Book = { charges: Record<string, Record_> };

export type StubOptions = {
  /** Where the stub keeps its records (STUB_STORE_PATH). */
  path: string;
  /** How long 0309 waits before approving (STUB_SLOW_APPROVE_MS), shorter than our timeout. */
  slowApproveMs: number;
  /** How long 0101 and 0200 stay silent, well past our timeout. */
  silenceMs: number;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    // Unref'd, so a silent charge never keeps a script or test run alive.
    setTimeout(resolve, ms).unref();
  });

export function stubPayments(options: StubOptions): PaymentGateway & { chargeCount(): number } {
  // One write at a time, so concurrent charges can't lose each other's records.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  function read(): Book {
    if (!existsSync(options.path)) return { charges: {} };
    return JSON.parse(readFileSync(options.path, "utf8")) as Book;
  }

  function write(book: Book): void {
    mkdirSync(dirname(options.path), { recursive: true });
    const temporary = `${options.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(book, null, 2));
    renameSync(temporary, options.path);
  }

  /** Records the outcome for a key unless it already has one, and returns whichever is kept. */
  function settle(key: string, amountCents: number, status: "charged" | "declined"): Promise<Record_> {
    return serial(() => {
      const book = read();
      if (!book.charges[key]) {
        book.charges[key] = {
          status,
          amountCents,
          at: new Date().toISOString(),
          ...(status === "charged" ? { chargeRef: `ch_${randomUUID().replace(/-/g, "").slice(0, 16)}` } : {}),
        };
        write(book);
      }
      return book.charges[key];
    });
  }

  function answerFor(record: Record_): ChargeAnswer {
    return record.status === "charged" ? { outcome: "approved", chargeRef: record.chargeRef! } : { outcome: "declined" };
  }

  return {
    acceptsCard: (cardNumber) => cardNumber in TEST_CARDS,

    async charge({ idempotencyKey, amountCents, card }) {
      const known = read().charges[idempotencyKey];
      if (known) return answerFor(known);
      const behaviour = TEST_CARDS[card.number]?.behaviour;
      switch (behaviour) {
        case "approve":
          return answerFor(await settle(idempotencyKey, amountCents, "charged"));
        case "decline":
          return answerFor(await settle(idempotencyKey, amountCents, "declined"));
        case "charge-then-silent": {
          const record = await settle(idempotencyKey, amountCents, "charged");
          await wait(options.silenceMs);
          return answerFor(record);
        }
        case "silent":
          // Never records anything: a lookup later finds no charge.
          await wait(options.silenceMs);
          throw new Error("The payment company never answered");
        case "slow-approve": {
          const record = await settle(idempotencyKey, amountCents, "charged");
          await wait(options.slowApproveMs);
          return answerFor(record);
        }
        default:
          return { outcome: "declined" };
      }
    },

    async lookup(idempotencyKey): Promise<LookupAnswer> {
      const record = read().charges[idempotencyKey];
      return record?.status === "charged" ? { status: "charged", chargeRef: record.chargeRef! } : { status: "not_charged" };
    },

    chargeCount: () => Object.values(read().charges).filter((record) => record.status === "charged").length,
  };
}
