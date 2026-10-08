import type { Metadata } from "next";
import { DemoBanner } from "@/ui/components/DemoBanner";
import styles from "../[token]/pay.module.css";

export const metadata: Metadata = { title: "New link sent" };

/**
 * After "Send me a new link" (L7, D87). A page of its own with no order details
 * and no link, since whoever pressed the button only had the old, expired link;
 * the fresh one went to the email on file.
 */
export default function LinkSent() {
  return (
    <>
      <DemoBanner />
      <main id="main" className={styles.main}>
        <h1>We&apos;ve sent you a new link</h1>
        <p className={styles.lede}>Check your email for a new link from your clinic. It works for 90 days.</p>
        <p className={styles.help}>If it doesn&apos;t arrive, contact the clinic that sent you this order.</p>
      </main>
    </>
  );
}
