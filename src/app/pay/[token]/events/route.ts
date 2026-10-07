// GET /pay/[token]/events (§8): the confirming page's status stream. The first
// event is the current state, so a reconnect never misses a result. Updates
// arrive through Postgres NOTIFY (D24), and every heartbeat rechecks the state
// too, in case a notification was missed while the listener reconnected.
import { linkSigningKey, sseHeartbeatMs, sseMaxMs } from "@/server/config";
import { db } from "@/server/db/client";
import { statusListener } from "@/server/db/listen";
import { payPage } from "@/server/payments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const read = async () => {
    const view = await payPage({ db, now: () => new Date(), linkSigningKey: linkSigningKey() }, token);
    // New link turns this link off while the page is open.
    return view?.state ?? "invalid";
  };
  const first = await payPage({ db, now: () => new Date(), linkSigningKey: linkSigningKey() }, token);
  if (!first) return new Response("This link isn't valid.", { status: 404 });

  const encoder = new TextEncoder();
  let last: string = first.state;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const status = (state: string) => send(`event: status\ndata: ${JSON.stringify({ state })}\n\n`);
      const recheck = async () => {
        const state = await read().catch(() => null);
        if (state && state !== last) {
          last = state;
          status(state);
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(ping);
        clearTimeout(end);
        unsubscribe();
        controller.close();
      };

      status(first.state);
      const unsubscribe = statusListener().subscribe(first.ref, () => void recheck());
      const ping = setInterval(() => {
        send(": ping\n\n");
        void recheck();
      }, sseHeartbeatMs());
      // After 5 minutes the page says "Still confirming" and stops listening (§5).
      const end = setTimeout(() => {
        send("event: done\ndata: {}\n\n");
        close();
      }, sseMaxMs());
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
