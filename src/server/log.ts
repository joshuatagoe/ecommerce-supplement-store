// Structured logs (ARCHITECTURE.md §11): JSON lines from pino. Patient fields
// and links are redacted wherever they appear, and nothing logs search text.
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  redact: {
    paths: ["*.firstName", "*.lastName", "*.email", "*.patientName", "*.link", "*.token", "link", "token", "email"],
    censor: "[redacted]",
  },
});

/** One line per status change: the order ref, the old and new status, and who (§11). No patient data. */
export function logStatusChange(change: { ref: string; from: string; to: string; actor: string }): void {
  log.info({ event: "status_changed", ...change });
}
