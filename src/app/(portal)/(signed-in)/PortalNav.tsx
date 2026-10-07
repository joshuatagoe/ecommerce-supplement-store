"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./portal.module.css";

const LINKS = [{ href: "/store", label: "My store" }];

/** Links, not buttons, for navigation (§9); the current page is marked for screen readers. */
export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Portal">
      <ul className={styles.nav}>
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} aria-current={pathname.startsWith(link.href) ? "page" : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
