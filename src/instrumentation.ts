// Runs once when a server starts. Starts the payment sweep on the Node runtime
// only (§5), and never while `next build` collects pages.
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startSweeper } = await import("./server/payments/sweeper");
  startSweeper();
}

/** Every unexpected server error becomes one JSON log line with its request's ID (§11, D85). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestError } = await import("./server/log");
  logRequestError(error, request, context);
};
