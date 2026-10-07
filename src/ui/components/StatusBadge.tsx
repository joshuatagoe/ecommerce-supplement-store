import type { ReactNode } from "react";
import { type DisplayStatus, STATUS_WORDS } from "@/shared/status";
import styles from "./StatusBadge.module.css";

const ICONS: Record<DisplayStatus, ReactNode> = {
  draft: <path d="M3 13l1-3.2 7-7 2.2 2.2-7 7z" />,
  sent: <path d="M2 8.5L14 3l-4 11-2.4-4.6z" />,
  expired: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 2" />
    </>
  ),
  needs_review: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8h.01M8 8h.01M11 8h.01" strokeWidth="2.2" />
    </>
  ),
  paid: <path d="M3 8.5l3 3 7-7" />,
  cancelled: <path d="M4 4l8 8M12 4l-8 8" />,
};

/**
 * The only place a status is shown (§9): its word from src/shared/status.ts
 * and an icon, so it never relies on colour alone.
 */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={styles.badge} data-status={status} data-testid="status-badge">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[status]}
        </g>
      </svg>
      {STATUS_WORDS[status]}
    </span>
  );
}
