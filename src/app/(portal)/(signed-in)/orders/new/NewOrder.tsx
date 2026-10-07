"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, ComboBox, Input, Label, ListBox, ListBoxItem, Popover, Text } from "react-aria-components";
import type { PatientMatch } from "@/server/ports/patient-directory";
import { formatDate } from "@/shared/dates";
import { formatCents } from "@/shared/money";
import type { DisplayStatus } from "@/shared/status";
import { StatusBadge } from "@/ui/components/StatusBadge";
import { type RecentOrderRow, recentOrdersAction, searchPatientsAction, startOrderAction } from "./actions";
import styles from "./new-order.module.css";

export function NewOrder({ timeZone }: { timeZone: string }) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<{ text: string; patients: PatientMatch[] }>({ text: "", patients: [] });
  const [patient, setPatient] = useState<PatientMatch | null>(null);
  const [recent, setRecent] = useState<RecentOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  // Search once typing pauses. The text goes in the request body, never the URL (§8).
  useEffect(() => {
    if (!text.trim()) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await searchPatientsAction({ text });
      if (current && result.ok) setMatches({ text, patients: result.patients });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  // Empty text finds no one, whatever the last search returned.
  const shown = text.trim() ? matches.patients : [];
  const searching = text.trim() !== "" && matches.text !== text;

  async function choose(id: string | null) {
    const chosen = shown.find((match) => match.id === id) ?? null;
    setPatient(chosen);
    setRecent(null);
    setError(null);
    if (!chosen) return;
    const result = await recentOrdersAction({ patientId: chosen.id });
    setRecent(result.ok ? result.orders : []);
  }

  function start(input: { patientId: string } | { fromOrderRef: string }) {
    setError(null);
    startTransition(async () => {
      const result = await startOrderAction(input);
      if (!result.ok) setError(result.error.message);
    });
  }

  return (
    <>
      <h1>New order</h1>
      <p className={styles.intro}>Choose a patient. Their recent orders appear below, so you can repeat one.</p>

      <ComboBox
        className={styles.combo}
        items={shown}
        inputValue={text}
        onInputChange={setText}
        onSelectionChange={(key) => choose(key === null ? null : String(key))}
        defaultFilter={() => true}
        menuTrigger="input"
        allowsEmptyCollection
      >
        <Label className={styles.label}>Patient</Label>
        <Text slot="description" className={styles.description}>
          Search by first or last name.
        </Text>
        <Input className={styles.input} />
        <Popover className={styles.popover}>
          <ListBox className={styles.listbox} renderEmptyState={() => <p className={styles.none}>{searching ? "Searching…" : "No patients match."}</p>}>
            {(match: PatientMatch) => (
              <ListBoxItem id={match.id} textValue={match.name} className={styles.option}>
                {match.name}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {patient && (
        <section className={styles.patient} aria-labelledby="patient-heading">
          <h2 id="patient-heading" ref={heading}>
            {patient.name}
          </h2>
          <Button
            className="button button-primary"
            isDisabled={pending}
            onPress={() => start({ patientId: patient.id })}
          >
            Start order for {patient.name}
          </Button>

          <h3 className={styles.recentHeading}>Recent orders</h3>
          {recent === null ? (
            <p className={styles.quiet}>Loading recent orders…</p>
          ) : recent.length === 0 ? (
            <p className={styles.quiet}>No past orders for {patient.name}.</p>
          ) : (
            <ul className={styles.recent} aria-label={`Recent orders for ${patient.name}`}>
              {recent.map((order) => (
                <li key={order.ref} className={styles.recentRow}>
                  <span className={styles.ref}>{order.ref}</span>
                  <span>{formatDate(order.createdAt, timeZone)}</span>
                  <StatusBadge status={order.display as DisplayStatus} />
                  <span>{order.totalCents === null ? "" : formatCents(order.totalCents)}</span>
                  <span>
                    {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                  </span>
                  <Button
                    className="button"
                    aria-label={`Order again: ${order.ref}`}
                    isDisabled={pending}
                    onPress={() => start({ fromOrderRef: order.ref })}
                  >
                    Order again
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
