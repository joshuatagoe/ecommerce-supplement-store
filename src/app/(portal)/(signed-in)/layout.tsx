import type { ReactNode } from "react";
import { DemoBanner } from "@/ui/components/DemoBanner";
import { signOut } from "../actions";
import { requireProvider } from "../session";
import { PortalNav } from "./PortalNav";
import styles from "./portal.module.css";

export const dynamic = "force-dynamic";

/** Every page behind the fake login: the header, the provider's name, and Sign out. */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const provider = await requireProvider();
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>
      <DemoBanner />
      <header className={styles.header}>
        <div className={styles.bar}>
          <p className={styles.brand}>Supplement store</p>
          <PortalNav />
          <div className={styles.who}>
            <p>
              <span className={styles.provider}>{provider.displayName}</span>
              <span className={styles.practice}>{provider.practiceName}</span>
            </p>
            <form action={signOut}>
              <button className="button">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </>
  );
}
