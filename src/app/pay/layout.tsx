import type { Metadata } from "next";
import type { ReactNode } from "react";
import { atkinson } from "@/ui/fonts";
import styles from "./[token]/pay.module.css";

export const metadata: Metadata = { referrer: "no-referrer" };

/** The patient's pages: phone first, Atkinson Hyperlegible Next at 19px (§9, D35). */
export default function PayLayout({ children }: { children: ReactNode }) {
  return <div className={`${atkinson.variable} ${styles.patient}`}>{children}</div>;
}
