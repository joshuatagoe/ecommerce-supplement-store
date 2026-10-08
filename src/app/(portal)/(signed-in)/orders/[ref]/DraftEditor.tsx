"use client";

// F2 steps 2–4: lines, quantity, price or margin, live "You earn", totals,
// autosave and Send. The shared Pricing module works out every number as the
// provider types; each save's response replaces them, and if the two ever
// differ the server wins and the mismatch is logged as a bug (§9).
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Button, Group, Input, Label, NumberField, Radio, RadioGroup } from "react-aria-components";
import type { OrderView, SavedLine } from "@/server/orders";
import type { StoreItem } from "@/server/store";
import { centsToField, formatCents, parseDollars, priceRangeMessage } from "@/shared/money";
import { checkPrice, lineSplit, orderTotals, priceForMarginCents, type Split, unitSplit } from "@/shared/pricing";
import { matchesProduct } from "@/shared/product-search";
import type { ActionError } from "@/shared/schemas";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { ProductImage } from "@/ui/components/ProductImage";
import { discardDraftAction, saveDraftAction, sendOrderAction } from "./actions";
import styles from "./order.module.css";

type Product = {
  catalogItemId: string;
  brand: string;
  name: string;
  sizeLabel: string;
  imagePath: string;
  imageAlt: string;
  costCents: number;
  msrpCents: number;
  lowestPriceCents: number;
  usualPriceCents: number | null;
  inStore: boolean;
};

type Mode = "price" | "margin";
type LineState = { catalogItemId: string; quantity: number; mode: Mode; text: string };

type Worked = {
  line: LineState;
  product: Product;
  priceCents: number | null;
  split: Split | null;
  problem: string | null;
  rangeMessage: string | null;
};

type SaveState = "saved" | "saving" | "retrying" | "invalid" | "failed";

const SAVE_WORDS: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Not saved, retrying",
  invalid: "Not saved. Fix the marked fields.",
  failed: "Not saved",
};

type Props = { order: OrderView; storeItems: StoreItem[]; feeRateBps: number; autosaveMs: number };

export function DraftEditor({ order, storeItems, feeRateBps, autosaveMs }: Props) {
  const router = useRouter();
  const products = useMemo(() => {
    const map = new Map<string, Product>();
    for (const line of order.lines) {
      map.set(line.catalogItemId, { ...line, usualPriceCents: null, inStore: false });
    }
    for (const item of storeItems) {
      map.set(item.id, {
        catalogItemId: item.id,
        brand: item.brand,
        name: item.name,
        sizeLabel: item.sizeLabel,
        imagePath: item.imagePath,
        imageAlt: item.imageAlt,
        costCents: item.costCents,
        msrpCents: item.msrpCents,
        lowestPriceCents: item.lowestPriceCents,
        usualPriceCents: item.usualPriceCents,
        inStore: true,
      });
    }
    return map;
  }, [order.lines, storeItems]);

  const [lines, setLines] = useState<LineState[]>(() =>
    order.lines.map((line) => ({
      catalogItemId: line.catalogItemId,
      quantity: line.quantity,
      mode: "price",
      text: centsToField(line.priceCents),
    })),
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [server, setServer] = useState<{ version: number; lines: SavedLine[] } | null>(null);
  const [edits, setEdits] = useState(0);
  const [sendError, setSendError] = useState<ActionError | null>(null);
  const [sending, startSending] = useTransition();
  const [search, setSearch] = useState("");
  const searchField = useRef<HTMLInputElement>(null);

  const linesRef = useRef(lines);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const retryMs = useRef(3000);
  const errorSummary = useRef<HTMLDivElement>(null);
  const itemsHeading = useRef<HTMLHeadingElement>(null);
  const priceFields = useRef(new Map<string, HTMLInputElement>());
  // An added line's price field takes focus once it has rendered.
  const focusLine = useRef<string | null>(null);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  function work(line: LineState): Worked {
    const product = products.get(line.catalogItemId)!;
    const amount = parseDollars(line.text);
    const base = { line, product, priceCents: null, split: null, rangeMessage: null };
    if (!product.inStore) return { ...base, problem: "This item isn't in My store any more. Remove it from the order." };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) {
      return { ...base, problem: "Choose a quantity from 1 to 10." };
    }
    if (amount === null) {
      return { ...base, problem: `Enter a ${line.mode} in dollars and cents, like ${line.mode === "price" ? "36.00" : "15.73"}.` };
    }
    const priceCents =
      line.mode === "price" ? amount : priceForMarginCents({ marginCents: amount, costCents: product.costCents, feeRateBps });
    const check = checkPrice({ priceCents, costCents: product.costCents, msrpCents: product.msrpCents, feeRateBps });
    return {
      line,
      product,
      priceCents,
      split: lineSplit({ priceCents, costCents: product.costCents, feeRateBps, quantity: line.quantity }),
      problem: null,
      rangeMessage: check.ok ? null : priceRangeMessage(check.code, check),
    };
  }

  // The server's numbers win once a save for exactly these edits comes back.
  const fresh = server !== null && server.version === edits ? server : null;
  const worked = lines.map((line) => {
    const live = work(line);
    const saved = fresh?.lines.find((s) => s.catalogItemId === line.catalogItemId);
    if (!saved || live.split === null) return live;
    return { ...live, priceCents: saved.priceCents, split: saved.split, rangeMessage: saved.rangeError?.message ?? null };
  });

  useEffect(() => {
    if (!fresh) return;
    for (const line of linesRef.current) {
      const live = work(line);
      const saved = fresh.lines.find((s) => s.catalogItemId === line.catalogItemId);
      if (saved && live.split && JSON.stringify(saved.split) !== JSON.stringify(live.split)) {
        console.error("Pricing mismatch between the browser and the server; showing the server's split", {
          catalogItemId: line.catalogItemId,
          browser: live.split,
          server: saved.split,
        });
      }
    }
    // Checked once per save response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  const totals = orderTotals(worked.flatMap((w) => (w.split ? [w.split] : [])));
  const savings = worked.reduce((sum, w) => sum + (w.priceCents === null ? 0 : (w.product.msrpCents - w.priceCents) * w.line.quantity), 0);
  const blocked = worked.some((w) => w.problem !== null || w.rangeMessage !== null);

  function edit(change: (current: LineState[]) => LineState[]) {
    version.current += 1;
    setLines(change);
    setSaveState("saving");
    setSaveError(null);
    setEdits((n) => n + 1);
  }

  async function save(): Promise<boolean> {
    if (inFlight.current) await inFlight.current;
    if (version.current === savedVersion.current) return true;
    const at = version.current;
    const snapshot = linesRef.current.map(work);
    if (snapshot.some((w) => w.problem !== null && w.product.inStore)) {
      setSaveState("invalid");
      return false;
    }
    const payload = snapshot
      .filter((w) => w.product.inStore)
      .map(({ line }) => {
        const amount = parseDollars(line.text)!;
        return line.mode === "price"
          ? { catalogItemId: line.catalogItemId, quantity: line.quantity, priceCents: amount }
          : { catalogItemId: line.catalogItemId, quantity: line.quantity, marginCents: amount };
      });
    setSaveState("saving");
    const attempt = (async () => {
      try {
        const result = await saveDraftAction({ ref: order.ref, lines: payload });
        if (result.ok) {
          savedVersion.current = Math.max(savedVersion.current, at);
          retryMs.current = 3000;
          setServer({ version: at, lines: result.lines });
          if (version.current === at) setSaveState("saved");
          return true;
        }
        if (result.error.code === "ORDER_NOT_DRAFT" || result.error.code === "NOT_FOUND") router.refresh();
        setSaveState("failed");
        setSaveError(result.error.message);
        return false;
      } catch {
        // The network or the server failed: keep the edits and try again, waiting longer each time.
        setSaveState("retrying");
        const wait = retryMs.current;
        retryMs.current = Math.min(wait * 2, 30_000);
        setTimeout(() => void save(), wait);
        return false;
      }
    })();
    inFlight.current = attempt;
    try {
      return await attempt;
    } finally {
      inFlight.current = null;
    }
  }

  // Autosave once editing pauses (§9).
  useEffect(() => {
    if (edits === 0 || version.current === savedVersion.current) return;
    const timer = setTimeout(() => void save(), autosaveMs);
    return () => clearTimeout(timer);
    // save reads the latest edits through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, autosaveMs]);

  useEffect(() => {
    if (!focusLine.current) return;
    priceFields.current.get(focusLine.current)?.focus();
    focusLine.current = null;
  }, [lines]);

  function add(product: Product) {
    edit((current) => [
      ...current,
      {
        catalogItemId: product.catalogItemId,
        quantity: 1,
        mode: "price",
        text: centsToField(product.usualPriceCents ?? product.lowestPriceCents),
      },
    ]);
    focusLine.current = product.catalogItemId;
  }

  function update(catalogItemId: string, change: Partial<LineState>) {
    edit((current) => current.map((line) => (line.catalogItemId === catalogItemId ? { ...line, ...change } : line)));
  }

  function switchMode(w: Worked, mode: Mode) {
    if (mode === w.line.mode) return;
    // Carry the amount over: a price becomes the margin it earns, and a margin the price that earns it.
    const unit = w.split && w.priceCents !== null ? w.split.marginCents / w.line.quantity : null;
    const text =
      w.priceCents === null ? w.line.text : centsToField(mode === "price" ? w.priceCents : Math.max(0, unit ?? 0));
    update(w.line.catalogItemId, { mode, text });
  }

  /** No profit and Max profit: the lowest price or retail, or in margin mode the margin each earns. */
  function fill(w: Worked, end: "lowest" | "retail") {
    const priceCents = end === "lowest" ? w.product.lowestPriceCents : w.product.msrpCents;
    const amount =
      w.line.mode === "price" ? priceCents : unitSplit({ priceCents, costCents: w.product.costCents, feeRateBps }).marginCents;
    update(w.line.catalogItemId, { text: centsToField(amount) });
  }

  function remove(catalogItemId: string) {
    edit((current) => current.filter((line) => line.catalogItemId !== catalogItemId));
    itemsHeading.current?.focus();
  }

  function send() {
    setSendError(null);
    startSending(async () => {
      if (!(await save())) {
        setSendError({ code: "INVALID_INPUT", message: "The order couldn't be saved, so it wasn't sent. Check the marked fields." });
        requestAnimationFrame(() => errorSummary.current?.focus());
        return;
      }
      const result = await sendOrderAction({ ref: order.ref });
      // On success the action opens the sent order, so a result means it failed.
      if (result && !result.ok) {
        setSendError(result.error);
        requestAnimationFrame(() => errorSummary.current?.focus());
      }
    });
  }

  const addable = storeItems.filter((item) => !lines.some((line) => line.catalogItemId === item.id));
  const shownAddable = addable.filter((item) => matchesProduct(item, search));
  const sendHint =
    lines.length === 0
      ? "Add an item to send."
      : blocked
        ? "Fix the items marked above to send."
        : null;

  return (
    <>
      <p className={styles.ref}>
        Draft <span data-testid="order-ref">{order.ref}</span>
      </p>
      <h1>New order for {order.patient.name}</h1>

      {sendError && (
        <div className={styles.errorSummary} role="alert" tabIndex={-1} ref={errorSummary}>
          <p>
            <span className="visually-hidden">Error: </span>
            {sendError.message}
          </p>
          {sendError.lines && (
            <ul>
              {sendError.lines.map((problem) => (
                <li key={problem.catalogItemId}>
                  {products.get(problem.catalogItemId)?.name}: {problem.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {order.leftOut.length > 0 && (
        <p className={styles.notice}>
          From order {order.sourceOrderRef}: {order.leftOut.join(", ")}{" "}
          {order.leftOut.length === 1 ? "isn't" : "aren't"} in My store any more, so{" "}
          {order.leftOut.length === 1 ? "it wasn't" : "they weren't"} copied.
        </p>
      )}

      <section aria-labelledby="items-heading" className={styles.section}>
        <h2 id="items-heading" ref={itemsHeading} tabIndex={-1}>
          Items
        </h2>
        {lines.length === 0 ? (
          <p className={styles.empty}>No items yet. Add one from My store below.</p>
        ) : (
          <ul className={styles.lines}>
            {worked.map((w) => (
              <li key={w.line.catalogItemId}>
                <LineEditor
                  worked={w}
                  onQuantity={(quantity) => update(w.line.catalogItemId, { quantity })}
                  onMode={(mode) => switchMode(w, mode)}
                  onText={(text) => update(w.line.catalogItemId, { text })}
                  onFill={(end) => fill(w, end)}
                  onRemove={() => remove(w.line.catalogItemId)}
                  priceRef={(element) => {
                    if (element) priceFields.current.set(w.line.catalogItemId, element);
                    else priceFields.current.delete(w.line.catalogItemId);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {addable.length > 0 && (
        <section aria-labelledby="add-heading" className={styles.section}>
          <h2 id="add-heading">Add from My store</h2>
          <div className={styles.addSearch}>
            <label htmlFor="add-search">Search My store</label>
            <input
              ref={searchField}
              id="add-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {shownAddable.length === 0 && (
            <p className={styles.empty}>
              No items in My store match “{search.trim()}”.{" "}
              <Button
                className="button"
                onPress={() => {
                  setSearch("");
                  searchField.current?.focus();
                }}
              >
                Clear search
              </Button>
            </p>
          )}
          <ul className={styles.addList}>
            {shownAddable.map((item) => (
              <li key={item.id}>
                <ProductImage src={item.imagePath} alt="" size={40} />
                <span className={styles.addName}>
                  {item.name}
                  <span className={styles.muted}>
                    {item.sizeLabel} · usual price {formatCents(item.usualPriceCents)}
                  </span>
                </span>
                <Button
                  className="button"
                  aria-label={`Add ${item.name} to this order`}
                  onPress={() => add(products.get(item.id)!)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="totals-heading" className={styles.totals}>
        <h2 id="totals-heading" className="visually-hidden">
          Totals
        </h2>
        <dl>
          <div>
            <dt>Total</dt>
            <dd data-testid="order-total">{formatCents(totals.priceCents)}</dd>
          </div>
          <div>
            <dt>You earn</dt>
            <dd>{formatCents(totals.marginCents)}</dd>
          </div>
          <div>
            <dt>Patient saves vs retail</dt>
            <dd>{formatCents(savings)}</dd>
          </div>
        </dl>
        <Announcer text={`Total ${formatCents(totals.priceCents)}. You earn ${formatCents(totals.marginCents)}.`} />
      </section>

      <div className={styles.sendBar}>
        <p className={styles.saveState} data-state={saveState} role="status">
          {SAVE_WORDS[saveState]}
        </p>
        {saveError && <p className={styles.fieldError}>{saveError}</p>}
        <div className={styles.sendButtons}>
          <ConfirmDialog action="Discard draft" title="Discard this draft?" keepLabel="Keep editing" onConfirm={() => discardDraftAction({ ref: order.ref })}>
            <p>The draft and its items will be thrown away. You can&apos;t undo this.</p>
          </ConfirmDialog>
          <Button
            className="button button-primary"
            isDisabled={lines.length === 0 || blocked || sending}
            onPress={send}
            aria-describedby={sendHint ? "send-hint" : undefined}
          >
            Send
          </Button>
        </div>
        {sendHint && (
          <p id="send-hint" className={styles.muted}>
            {sendHint}
          </p>
        )}
      </div>
    </>
  );
}

type LineProps = {
  worked: Worked;
  onQuantity: (quantity: number) => void;
  onMode: (mode: Mode) => void;
  onText: (text: string) => void;
  onFill: (end: "lowest" | "retail") => void;
  onRemove: () => void;
  priceRef: (element: HTMLInputElement | null) => void;
};

function LineEditor({ worked, onQuantity, onMode, onText, onFill, onRemove, priceRef }: LineProps) {
  const id = useId();
  const { line, product, split, priceCents, problem, rangeMessage } = worked;
  const message = problem ?? rangeMessage;
  const amountLabel = line.mode === "price" ? "Price per bottle" : "Margin per bottle";
  return (
    <div className={styles.line} role="group" aria-labelledby={`${id}-name`}>
      <ProductImage src={product.imagePath} alt={product.imageAlt} size={56} />
      <div className={styles.product}>
        <p className={styles.muted}>{product.brand}</p>
        <h3 id={`${id}-name`}>{product.name}</h3>
        <p className={styles.muted}>
          {product.sizeLabel} · lowest {formatCents(product.lowestPriceCents)} · retail {formatCents(product.msrpCents)}
        </p>
      </div>

      <NumberField
        className={styles.quantity}
        value={line.quantity}
        onChange={onQuantity}
        minValue={1}
        maxValue={10}
        step={1}
        formatOptions={{ maximumFractionDigits: 0 }}
      >
        <Label>Quantity</Label>
        <Group className={styles.stepper}>
          <Button slot="decrement" aria-label="Fewer">
            −
          </Button>
          <Input />
          <Button slot="increment" aria-label="More">
            +
          </Button>
        </Group>
      </NumberField>

      <div className={styles.amount}>
        <RadioGroup className={styles.mode} value={line.mode} onChange={(value) => onMode(value as Mode)} orientation="horizontal">
          <Label>Set by</Label>
          <div>
            <Radio value="price">Price</Radio>
            <Radio value="margin">Margin</Radio>
          </div>
        </RadioGroup>
        <label htmlFor={`${id}-amount`}>{amountLabel}</label>
        <div className={styles.inputWrap}>
          <span aria-hidden="true">$</span>
          <input
            ref={priceRef}
            id={`${id}-amount`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={line.text}
            onChange={(event) => onText(event.target.value)}
            aria-invalid={message ? true : undefined}
            aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
          />
        </div>
        <p id={`${id}-hint`} className={styles.hint}>
          {line.mode === "margin" && priceCents !== null && <span>Price {formatCents(priceCents)}</span>}
          {split && <span className={styles.earn}>You earn {formatCents(split.marginCents)}</span>}
          {split && (
            <span className={styles.amounts}>
              <span>Cost {formatCents(split.costCents)}</span>
              <span>Fee {formatCents(split.feeCents)}</span>
            </span>
          )}
          {split && priceCents !== null && (
            <span>
              {priceCents > product.msrpCents
                ? `Above the retail price, ${formatCents(product.msrpCents)}`
                : `Patient saves ${formatCents((product.msrpCents - priceCents) * line.quantity)} vs retail`}
            </span>
          )}
        </p>
        {message && (
          <p id={`${id}-error`} className={styles.fieldError}>
            {message}
          </p>
        )}
        <div className={styles.fills}>
          <Button className="button" onPress={() => onFill("lowest")}>
            No profit
          </Button>
          <Button className="button" onPress={() => onFill("retail")}>
            Max profit
          </Button>
        </div>
      </div>

      <Button className="button" aria-label={`Remove ${product.name}`} onPress={onRemove}>
        Remove
      </Button>
    </div>
  );
}

/** Reads out a change once it settles, without moving focus (§9). */
function Announcer({ text }: { text: string }) {
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(text), 1000);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <span className="visually-hidden" aria-live="polite">
      {spoken}
    </span>
  );
}
