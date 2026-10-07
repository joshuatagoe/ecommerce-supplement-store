// One LISTEN connection per server for order status changes (D24), fanned out
// to every open pay page by order ref. It needs a direct database connection:
// transaction-mode poolers drop LISTEN (§17). If the connection drops, it
// reconnects, and each page rechecks its order when it next hears anything.
import pg from "pg";
import { STATUS_CHANNEL } from "./notify.ts";

type Watcher = (ref: string) => void;

export class StatusListener {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private retryMs = 1_000;
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  /** Watches one order. Returns a function that stops watching. */
  subscribe(ref: string, watcher: Watcher): () => void {
    void this.ready().catch(() => {});
    const set = this.watchers.get(ref) ?? new Set();
    set.add(watcher);
    this.watchers.set(ref, set);
    return () => {
      set.delete(watcher);
      if (set.size === 0) this.watchers.delete(ref);
    };
  }

  /** Resolves once the connection is listening. */
  ready(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on("notification", (message) => {
      if (message.channel !== STATUS_CHANNEL || !message.payload) return;
      for (const watcher of this.watchers.get(message.payload) ?? []) watcher(message.payload);
    });
    client.on("error", () => this.dropped(client));
    client.on("end", () => this.dropped(client));
    await client.connect();
    await client.query(`LISTEN ${STATUS_CHANNEL}`);
    this.client = client;
    this.retryMs = 1_000;
  }

  private dropped(client: pg.Client): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.closed) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(wait * 2, 30_000);
    setTimeout(() => void this.ready().catch(() => {}), wait).unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = null;
    await client?.end();
  }
}

/** The server's one listener, kept across development reloads. */
export function statusListener(): StatusListener {
  const cache = globalThis as unknown as { statusListener?: StatusListener };
  cache.statusListener ??= new StatusListener(process.env.DATABASE_URL ?? "");
  return cache.statusListener;
}
