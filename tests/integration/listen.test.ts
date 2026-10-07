// Status changes reach open pay pages through Postgres LISTEN/NOTIFY (D24): one
// listening connection per server, fanned out to each page by order ref.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StatusListener } from "@/server/db/listen";
import { type Scratch, scratchDatabase } from "./scratch";

let scratch: Scratch;
let listener: StatusListener;

beforeAll(async () => {
  scratch = await scratchDatabase("listen");
  listener = new StatusListener(scratch.url);
}, 30_000);
afterAll(async () => {
  await listener?.close();
  await scratch?.drop();
});

function next(ref: string): Promise<string> {
  return new Promise((resolve) => {
    const stop = listener.subscribe(ref, (heard) => {
      stop();
      resolve(heard);
    });
  });
}

describe("StatusListener", () => {
  it("passes a NOTIFY for an order to the pages watching that order", async () => {
    const heard = next("K7Q2-M9XD");
    await listener.ready();
    await scratch.pool.query("SELECT pg_notify('order_status', 'K7Q2-M9XD')");
    expect(await heard).toBe("K7Q2-M9XD");
  });

  it("doesn't pass on another order's changes", async () => {
    let wrong = 0;
    const stop = listener.subscribe("AAAA-AAAA", () => (wrong += 1));
    const heard = next("BBBB-BBBB");
    await listener.ready();
    await scratch.pool.query("SELECT pg_notify('order_status', 'BBBB-BBBB')");
    await heard;
    stop();
    expect(wrong).toBe(0);
  });

  it("hears nothing from a transaction that rolled back", async () => {
    let heard = 0;
    const stop = listener.subscribe("CCCC-CCCC", () => (heard += 1));
    await listener.ready();
    const client = await scratch.pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_notify('order_status', 'CCCC-CCCC')");
    await client.query("ROLLBACK");
    client.release();
    const later = next("DDDD-DDDD");
    await scratch.pool.query("SELECT pg_notify('order_status', 'DDDD-DDDD')");
    await later;
    stop();
    expect(heard).toBe(0);
  });
});
