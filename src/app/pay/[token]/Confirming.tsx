"use client";

// "We're confirming your payment" (§5, D23, D24). The page listens on SSE and
// reloads itself once the order settles: paid shows the receipt, and a payment
// that didn't go through brings the form back with that message.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./pay.module.css";

export function Confirming({ token }: { token: string }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const events = new EventSource(`/pay/${token}/events`);
    events.addEventListener("status", (event) => {
      const { state } = JSON.parse((event as MessageEvent<string>).data) as { state: string };
      if (state === "confirming") return;
      events.close();
      if (state === "checkout") router.replace(`/pay/${token}?notice=retry`);
      else router.refresh();
    });
    // The stream closes after 5 minutes; don't let the browser reconnect for ever.
    events.addEventListener("done", () => {
      events.close();
      setGaveUp(true);
    });
    return () => events.close();
  }, [router, token]);

  return (
    <>
      <span className={`${styles.mark} ${styles.waitMark}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2" />
        </svg>
      </span>
      <h1>We&apos;re confirming your payment</h1>
      <p className={styles.lede}>Don&apos;t pay again. This page updates by itself.</p>
      <p className={styles.status} role="status">
        {gaveUp
          ? "Still confirming. You won't be charged twice. You can close this page and reopen your link later."
          : ""}
      </p>
      <noscript>
        <p>
          <a href={`/pay/${token}`}>Check again</a>
        </p>
      </noscript>
    </>
  );
}
