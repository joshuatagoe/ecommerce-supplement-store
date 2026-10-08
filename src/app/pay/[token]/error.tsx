"use client";

// Anything unexplained on the pay page: a lost connection, a server error, or
// the database being down when the link is opened (found in M8's outage
// drill). The page can't tell whether a payment was just made, so it never
// says "declined" (D23). It tells someone who just paid not to pay again, and
// everyone to reload in a moment (D73).
import styles from "./pay.module.css";

export default function PayError() {
  return (
    <main id="main" className={styles.main}>
      <h1>We couldn&apos;t load this page</h1>
      <p className={styles.lede}>
        If you just paid, don&apos;t pay again: your payment may still be going through. Reload this page in a moment to
        see where things stand.
      </p>
      <button className="button button-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </main>
  );
}
