// Runs once when a server starts. Starts the payment sweep on the Node runtime
// only (§5), and never while `next build` collects pages.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startSweeper } = await import("./server/payments/sweeper");
  startSweeper();
}
