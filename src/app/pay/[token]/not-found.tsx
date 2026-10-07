import { DemoBanner } from "@/ui/components/DemoBanner";
import styles from "./pay.module.css";

/**
 * §6: a replaced, broken, made-up or old-key link. One message for all of
 * them, with HTTP 404, so it reveals nothing, not even whether the order exists.
 */
export default function InvalidLink() {
  return (
    <>
      <title>Link not valid</title>
      <DemoBanner />
      <main id="main" className={styles.main}>
        <h1>This link isn&apos;t valid</h1>
        <p className={styles.lede}>
          If your provider sent you a newer link, use that one. Otherwise, contact the clinic that sent you this link.
        </p>
      </main>
    </>
  );
}
