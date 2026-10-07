// Runs the sweep every SWEEP_EVERY_MS, and once when the server starts (§5).
// Started from instrumentation.ts on the Node runtime; it needs a server that
// stays running, and on Render Free it pauses while the app sleeps (D34).
import { sweepEveryMs } from "../config.ts";
import { paymentsContext } from "../context.ts";
import { log } from "../log.ts";
import { sweep } from "./index.ts";

export function startSweeper(): void {
  const cache = globalThis as unknown as { sweeper?: ReturnType<typeof setInterval> };
  if (cache.sweeper) return;
  let running = false;
  const tick = async () => {
    // A slow sweep finishes before the next one starts.
    if (running) return;
    running = true;
    try {
      const result = await sweep(paymentsContext());
      if (result.checked > 0) log.info({ event: "sweep", ...result });
    } catch (error) {
      log.warn({ event: "sweep_failed", message: (error as Error).message });
    } finally {
      running = false;
    }
  };
  void tick();
  cache.sweeper = setInterval(tick, sweepEveryMs());
}
