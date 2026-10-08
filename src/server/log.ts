// Structured logs (ARCHITECTURE.md §11): JSON lines from pino. Patient fields
// and links are redacted wherever they appear, and nothing logs search text.
// Lines written while handling a request carry its ID (D85).
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  redact: {
    paths: ["*.firstName", "*.lastName", "*.email", "*.patientName", "*.link", "*.token", "link", "token", "email"],
    censor: "[redacted]",
  },
});

/** One line per status change: the order ref, the old and new status, who, and the request that made it (§11). No patient data. */
export function logStatusChange(change: { ref: string; from: string; to: string; actor: string; requestId?: string }): void {
  log.info({ event: "status_changed", ...change });
}

type ErrorRequest = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type ErrorContext = { routePath: string; routeType: string };

/** Database errors can quote the data they choked on, so only their code is kept. */
function describeError(error: unknown): { name: string; message?: string; code?: string } {
  if (!(error instanceof Error)) return { name: "unknown" };
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? { name: error.name, code } : { name: error.name, message: error.message };
}

/**
 * One line per unexpected server error (D85), from instrumentation's
 * onRequestError: the request ID, the method, the path without its query
 * string and with any pay-link token replaced, the route, and Next's digest,
 * which matches the error page. No headers, so no cookies.
 */
export function logRequestError(error: unknown, request: ErrorRequest, context: ErrorContext): void {
  const id = request.headers["x-request-id"];
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  log.error({
    event: "request_error",
    requestId: (Array.isArray(id) ? id[0] : id) ?? null,
    method: request.method,
    path: request.path.split("?")[0].replace(/^\/pay\/[^/]+/, "/pay/[token]"),
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    error: describeError(error),
  });
}
