"use client";

import { useEffect, useRef } from "react";
import styles from "./pay.module.css";

/** After a failed Pay, focus moves here, with the hidden prefix "Error:" (§9). */
export function ErrorSummary({ message, items = [] }: { message: string; items?: { href: string; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [message, items.length]);
  return (
    <div ref={ref} className={styles.errorSummary} role="alert" tabIndex={-1}>
      <p>
        <span className="visually-hidden">Error: </span>
        {message}
      </p>
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.text}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
