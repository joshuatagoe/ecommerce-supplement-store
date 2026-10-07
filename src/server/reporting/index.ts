// Reporting (ARCHITECTURE.md §3, §8 "Sales list"): the Sales list, its
// totals, Order details' audit trail, and the platform metrics. Read only.
// Every provider query is limited to that provider. Dates are filtered in the
// practice's time zone (D29); totals always come from the database (§11), and
// sums are read as strings, never as floats (§12).
import { type SQL, sql } from "drizzle-orm";
import { type DisplayStatus, displayStatus, type SalesAction, salesActions } from "../../shared/status.ts";
import type { Db } from "../db/client.ts";

export { platformMetrics, type MonthMetrics } from "./metrics.ts";

type ReadContext = { db: Db; now: () => Date };
type ProviderView = { id: string; timeZone: string };

export type SalesFilters = {
  text?: string;
  status?: DisplayStatus;
  dateField: "created" | "sent" | "paid";
  from?: string;
  to?: string;
  cursor?: string;
};

export type SalesRow = {
  ref: string;
  patientName: string;
  display: DisplayStatus;
  actions: SalesAction[];
  createdAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  linkExpiresAt: Date | null;
  linkVersion: number | null;
  /** A draft's is the sum of its lines so far. */
  totalCents: number;
  /** Known once sent: a draft's earnings depend on the cost at Send (D27). */
  marginCents: number | null;
};

export type PaidTotals = { count: number; totalCents: number; marginCents: number; feeCents: number };

const DATE_COLUMNS = { created: "o.created_at", sent: "o.sent_at", paid: "o.paid_at" } as const;

/** Whole cents from a database sum, which pg returns as a string. */
const cents = (value: unknown) => Number(value ?? 0);

// LIKE treats % and _ as wildcards; typed text is matched literally.
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function conditions(ctx: ReadContext, provider: ProviderView, filters: SalesFilters): SQL {
  const parts: SQL[] = [sql`o.provider_id = ${provider.id}`];
  const text = filters.text?.trim();
  if (text) {
    parts.push(
      sql`((p.first_name || ' ' || p.last_name) ILIKE ${`%${literal(text)}%`} OR o.ref ILIKE ${`${literal(text)}%`})`,
    );
  }
  const now = ctx.now();
  if (filters.status === "sent") parts.push(sql`o.status = 'sent' AND o.link_expires_at > ${now}`);
  else if (filters.status === "expired") parts.push(sql`o.status = 'sent' AND o.link_expires_at <= ${now}`);
  else if (filters.status) parts.push(sql`o.status = ${filters.status}`);
  // A day in the practice's own calendar (D29).
  const column = sql.raw(DATE_COLUMNS[filters.dateField]);
  if (filters.from) parts.push(sql`(${column} AT TIME ZONE ${provider.timeZone})::date >= ${filters.from}::date`);
  if (filters.to) parts.push(sql`(${column} AT TIME ZONE ${provider.timeZone})::date <= ${filters.to}::date`);
  return sql.join(parts, sql` AND `);
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const offset = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).offset;
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ offset })).toString("base64url");

/**
 * §8 searchOrders: every order the provider created, newest first by the
 * chosen date (orders without it last), 25 to a page, with the count of all
 * matches and the totals of the paid orders among them.
 */
export async function searchOrders(
  ctx: ReadContext,
  provider: ProviderView,
  filters: SalesFilters,
  pageSize = 25,
): Promise<{ rows: SalesRow[]; count: number; footerTotals: PaidTotals; nextCursor: string | null }> {
  const where = conditions(ctx, provider, filters);
  const column = sql.raw(DATE_COLUMNS[filters.dateField]);
  const offset = decodeCursor(filters.cursor);

  const page = await ctx.db.execute(sql`
    SELECT o.ref, p.first_name, p.last_name, o.status, o.link_expires_at, o.link_version,
           o.created_at, o.sent_at, o.paid_at, o.margin_cents,
           COALESCE(o.total_cents, (SELECT sum(l.unit_price_cents * l.quantity) FROM order_lines l WHERE l.order_id = o.id))::text AS total_cents,
           EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id = o.id AND a.status = 'pending') AS payment_in_progress
      FROM orders o JOIN patients p ON p.id = o.patient_id
     WHERE ${where}
     ORDER BY ${column} DESC NULLS LAST, o.created_at DESC, o.id DESC
     LIMIT ${pageSize} OFFSET ${offset}`);
  const [totals] = (
    await ctx.db.execute(sql`
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE o.status = 'paid')::int AS paid,
             COALESCE(sum(o.total_cents) FILTER (WHERE o.status = 'paid'), 0)::text AS total,
             COALESCE(sum(o.margin_cents) FILTER (WHERE o.status = 'paid'), 0)::text AS margin,
             COALESCE(sum(o.fee_cents) FILTER (WHERE o.status = 'paid'), 0)::text AS fee
        FROM orders o JOIN patients p ON p.id = o.patient_id
       WHERE ${where}`)
  ).rows;

  const now = ctx.now();
  const rows: SalesRow[] = page.rows.map((row) => {
    const linkExpiresAt = row.link_expires_at === null ? null : new Date(row.link_expires_at as string);
    const state = {
      status: row.status as SalesRow["display"] & ("draft" | "sent" | "needs_review" | "paid" | "cancelled"),
      linkExpiresAt,
      paymentInProgress: Boolean(row.payment_in_progress),
    };
    return {
      ref: row.ref as string,
      patientName: `${row.first_name} ${row.last_name}`,
      display: displayStatus(state, now),
      actions: salesActions(state, now),
      createdAt: new Date(row.created_at as string),
      sentAt: row.sent_at === null ? null : new Date(row.sent_at as string),
      paidAt: row.paid_at === null ? null : new Date(row.paid_at as string),
      linkExpiresAt,
      linkVersion: row.link_version === null ? null : Number(row.link_version),
      totalCents: cents(row.total_cents),
      marginCents: row.margin_cents === null ? null : Number(row.margin_cents),
    };
  });
  const count = Number(totals.count);
  return {
    rows,
    count,
    footerTotals: {
      count: Number(totals.paid),
      totalCents: cents(totals.total),
      marginCents: cents(totals.margin),
      feeCents: cents(totals.fee),
    },
    nextCursor: offset + pageSize < count ? encodeCursor(offset + pageSize) : null,
  };
}

/** The headline (D31): this month so far by paid date in the practice's time zone, ignoring filters. */
export async function monthTotals(ctx: ReadContext, provider: ProviderView): Promise<PaidTotals & { month: string }> {
  const now = ctx.now();
  const [row] = (
    await ctx.db.execute(sql`
      SELECT count(*)::int AS count, COALESCE(sum(total_cents), 0)::text AS total,
             COALESCE(sum(margin_cents), 0)::text AS margin, COALESCE(sum(fee_cents), 0)::text AS fee
        FROM orders
       WHERE provider_id = ${provider.id} AND status = 'paid' AND paid_at <= ${now}
         AND (paid_at AT TIME ZONE ${provider.timeZone}) >= date_trunc('month', ${now}::timestamptz AT TIME ZONE ${provider.timeZone})`)
  ).rows;
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: provider.timeZone }).format(now),
    count: Number(row.count),
    totalCents: cents(row.total),
    marginCents: cents(row.margin),
    feeCents: cents(row.fee),
  };
}

export type AuditEvent = {
  kind: string;
  actorType: "provider" | "patient" | "sweep" | "system";
  actorName: string | null;
  at: Date;
  details: Record<string, unknown> | null;
};

/** Order details (F5): the audit trail in time order, and the payment company's reference for a paid order. */
export async function orderAudit(
  ctx: ReadContext,
  provider: ProviderView,
  ref: string,
): Promise<{ events: AuditEvent[]; chargeRef: string | null } | null> {
  const [order] = (
    await ctx.db.execute(sql`
      SELECT o.id, a.charge_ref FROM orders o LEFT JOIN payment_attempts a ON a.id = o.paid_attempt_id
       WHERE o.ref = ${ref} AND o.provider_id = ${provider.id}`)
  ).rows;
  if (!order) return null;
  const events = await ctx.db.execute(sql`
    SELECT e.kind, e.actor_type, pr.display_name AS actor_name, e.at, e.details
      FROM order_events e LEFT JOIN providers pr ON pr.id = e.actor_id
     WHERE e.order_id = ${order.id}
     ORDER BY e.at, e.id`);
  return {
    chargeRef: (order.charge_ref as string | null) ?? null,
    events: events.rows.map((event) => ({
      kind: event.kind as string,
      actorType: event.actor_type as AuditEvent["actorType"],
      actorName: (event.actor_name as string | null) ?? null,
      at: new Date(event.at as string),
      details: (event.details as Record<string, unknown> | null) ?? null,
    })),
  };
}
