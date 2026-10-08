"use client";

// F1 (USERS.md): the provider's items with their usual prices, and the catalog
// to add from. "You earn" is worked out here by the shared Pricing module as
// the provider types; the server checks the price again when it's saved (§9).
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import type { CatalogItem, StoreItem } from "@/server/store";
import { centsToField, formatCents, parseDollars } from "@/shared/money";
import { unitSplit } from "@/shared/pricing";
import { ProductImage } from "@/ui/components/ProductImage";
import { removeStoreItemAction, saveStoreItemAction } from "./actions";
import styles from "./store.module.css";

type Props = { catalog: CatalogItem[]; items: StoreItem[]; feeRateBps: number };

export function StoreEditor({ catalog, items, feeRateBps }: Props) {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const itemsHeading = useRef<HTMLHeadingElement>(null);
  const inStore = new Set(items.map((item) => item.id));

  // Added items start at the no-profit price (the user's call, 2026-10-07 grill).
  function add(product: CatalogItem) {
    setAddError(null);
    startAdding(async () => {
      const result = await saveStoreItemAction({ catalogItemId: product.id, usualPriceCents: product.lowestPriceCents });
      if (result.ok) {
        setJustAdded(product.id);
        setMessage(`Added ${product.name} at ${formatCents(product.lowestPriceCents)}, the no-profit price.`);
      } else {
        setAddError(result.error.message);
      }
    });
  }

  function removed(product: StoreItem) {
    setMessage(`Removed ${product.name} from My store.`);
    itemsHeading.current?.focus();
  }

  return (
    <>
      <h1>My store</h1>
      <p className={styles.intro}>
        Set a usual price for each item you sell. New orders start at that price, and you can change it for any one
        order.
      </p>
      <p className="visually-hidden" role="status">
        {message}
      </p>

      <section aria-labelledby="your-items" className={styles.section}>
        <h2 id="your-items" ref={itemsHeading} tabIndex={-1}>
          Your items
        </h2>
        {items.length === 0 ? (
          <p className={styles.empty}>Your store is empty. Add items from the catalog below.</p>
        ) : (
          <ul className={styles.items}>
            {items.map((item) => (
              <li key={item.id}>
                <StoreItemForm
                  item={item}
                  feeRateBps={feeRateBps}
                  focusOnMount={item.id === justAdded}
                  onRemoved={() => removed(item)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="catalog" className={styles.section}>
        <h2 id="catalog">Catalog</h2>
        <p className={styles.intro}>
          Every product we stock. The lowest price covers our cost and the 0.75% fee, so you earn $0.00 at it. The
          highest is the retail price.
        </p>
        {addError && (
          <p className={styles.error} role="alert">
            {addError}
          </p>
        )}
        <div className={styles.tableWrap} role="region" aria-labelledby="catalog" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className={styles.num}>
                  Our cost
                </th>
                <th scope="col" className={styles.num}>
                  Lowest price
                </th>
                <th scope="col" className={styles.num}>
                  Retail price
                </th>
                <th scope="col">
                  <span className="visually-hidden">My store</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((product) => (
                <tr key={product.id}>
                  <th scope="row">
                    <span className={styles.product}>
                      <ProductImage src={product.imagePath} alt="" size={40} />
                      <span>
                        <span className={styles.brand}>{product.brand}</span> {product.name}
                        <span className={styles.size}>{product.sizeLabel}</span>
                      </span>
                    </span>
                  </th>
                  <td className={styles.num}>{formatCents(product.costCents)}</td>
                  <td className={styles.num}>{formatCents(product.lowestPriceCents)}</td>
                  <td className={styles.num}>{formatCents(product.msrpCents)}</td>
                  <td>
                    {inStore.has(product.id) ? (
                      <span className={styles.added}>In My store</span>
                    ) : (
                      <button
                        className="button"
                        aria-label={`Add ${product.name} to My store`}
                        disabled={adding}
                        onClick={() => add(product)}
                      >
                        Add
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type FormProps = { item: StoreItem; feeRateBps: number; focusOnMount: boolean; onRemoved: () => void };

function StoreItemForm({ item, feeRateBps, focusOnMount, onRemoved }: FormProps) {
  const id = useId();
  const priceRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(centsToField(item.usualPriceCents));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (focusOnMount) priceRef.current?.focus();
  }, [focusOnMount]);

  const cents = parseDollars(text);
  const earning = cents === null ? null : unitSplit({ priceCents: cents, costCents: item.costCents, feeRateBps });
  // One line each under the field; a list is one line of labelled amounts.
  const hint: (string | string[])[] =
    cents === null
      ? ["Enter a price like 36.00."]
      : [
          `You earn ${formatCents(earning!.marginCents)}`,
          [`Cost ${formatCents(item.costCents)}`, `Fee ${formatCents(earning!.feeCents)}`],
          cents > item.msrpCents
            ? `Above the retail price, ${formatCents(item.msrpCents)}`
            : `Patient saves ${formatCents(item.msrpCents - cents)} vs retail`,
        ];

  // "You earn" is announced once typing pauses, never on every keystroke (§9).
  const spoken = hint.map((part) => (Array.isArray(part) ? part.join(", ") : part)).join(". ");
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(spoken), 1000);
    return () => clearTimeout(timer);
  }, [spoken]);

  function change(value: string) {
    setText(value);
    setStatus("");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (cents === null) {
      setError("Enter a price in dollars and cents, like 36.00.");
      setStatus("Not saved");
      return;
    }
    startTransition(async () => {
      const result = await saveStoreItemAction({ catalogItemId: item.id, usualPriceCents: cents });
      if (result.ok) {
        setError(null);
        setText(centsToField(cents));
        setStatus("Saved");
      } else {
        setError(result.error.message);
        setStatus("Not saved");
      }
    });
  }

  /** No profit and Max profit fill in the ends of the allowed range: the lowest price and retail. */
  function fill(priceCents: number) {
    change(centsToField(priceCents));
    setError(null);
  }

  function remove() {
    startTransition(async () => {
      const result = await removeStoreItemAction({ catalogItemId: item.id });
      if (result.ok) onRemoved();
      else setStatus("Not removed. Try again.");
    });
  }

  return (
    <form className={styles.item} aria-label={item.name} onSubmit={save} noValidate>
      <ProductImage src={item.imagePath} alt={item.imageAlt} size={64} />
      <div className={styles.details}>
        <p className={styles.brand}>{item.brand}</p>
        <h3 className={styles.name}>{item.name}</h3>
        <p className={styles.size}>{item.sizeLabel}</p>
        <p className={styles.bounds}>
          <span>Cost {formatCents(item.costCents)}</span>
          <span>Lowest {formatCents(item.lowestPriceCents)}</span>
          <span>Retail {formatCents(item.msrpCents)}</span>
        </p>
      </div>
      <div className={styles.price}>
        <label htmlFor={`${id}-price`}>Usual price</label>
        <div className={styles.inputWrap}>
          <span aria-hidden="true">$</span>
          <input
            ref={priceRef}
            id={`${id}-price`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(event) => change(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
          />
        </div>
        <p id={`${id}-hint`} className={styles.hint}>
          {hint.map((part) =>
            Array.isArray(part) ? (
              <span key={part.join()} className={styles.amounts}>
                {part.map((amount) => (
                  <span key={amount}>{amount}</span>
                ))}
              </span>
            ) : (
              <span key={part}>{part}</span>
            ),
          )}
        </p>
        {error && (
          <p id={`${id}-error`} className={styles.fieldError} role="alert">
            {error}
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {announcement}
        </span>
      </div>
      <div className={styles.actions}>
        <button type="button" className="button" onClick={() => fill(item.lowestPriceCents)} disabled={pending}>
          No profit
        </button>
        <button type="button" className="button" onClick={() => fill(item.msrpCents)} disabled={pending}>
          Max profit
        </button>
        <button type="submit" className="button button-primary" disabled={pending}>
          Save
        </button>
        <button type="button" className="button" onClick={remove} disabled={pending}>
          Remove
        </button>
        <p className={styles.status} data-tone={status === "Saved" ? "success" : "error"} role="status">
          {status}
        </p>
      </div>
    </form>
  );
}
