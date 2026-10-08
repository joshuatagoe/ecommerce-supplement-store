// Sales' quick filter shortcuts (L5): one click sets ordinary filters, and the
// summary then describes that view. Dates are days in the practice's own
// calendar (D29), written as YYYY-MM-DD like the date filters.

export type ShortcutParams = {
  status?: "paid" | "sent" | "draft";
  dateField?: "created" | "paid";
  from?: string;
  to?: string;
};

export type SalesShortcut = { label: string; params: ShortcutParams };

/** Today's date in the time zone, as YYYY-MM-DD. */
function today(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A calendar day moved by whole days or months, worked out in UTC so no clock change can shift it. */
function shift(day: string, { days = 0, months = 0 }: { days?: number; months?: number }): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, date + days)).toISOString().slice(0, 10);
}

export function salesShortcuts(now: Date, timeZone: string): SalesShortcut[] {
  const day = today(now, timeZone);
  const monthStart = `${day.slice(0, 8)}01`;
  const lastMonthStart = shift(monthStart, { months: -1 });
  return [
    { label: "Paid this month", params: { status: "paid", dateField: "paid", from: monthStart, to: day } },
    { label: "Paid last month", params: { status: "paid", dateField: "paid", from: lastMonthStart, to: shift(monthStart, { days: -1 }) } },
    { label: "Last 90 days", params: { dateField: "created", from: shift(day, { days: -89 }), to: day } },
    { label: "Waiting for payment", params: { status: "sent" } },
    { label: "Drafts", params: { status: "draft" } },
  ];
}
