import styles from "./DemoBanner.module.css";

/** On every page: this is a demo, and nothing can be bought (D15, §10). */
export function DemoBanner() {
  return (
    <p className={styles.banner} role="note">
      Demo — not a real store
    </p>
  );
}
