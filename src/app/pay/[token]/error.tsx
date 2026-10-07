"use client";

// Anything unexplained during Pay, such as a lost connection or a server
// error, shows "confirming", never "declined" (D23). Reloading shows the
// order's real state.
import styles from "./pay.module.css";

export default function PayError() {
  return (
    <main id="main" className={styles.main}>
      <h1>We&apos;re confirming your payment</h1>
      <p className={styles.lede}>Don&apos;t pay again. Reload this page in a moment to see where things stand.</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </main>
  );
}
