// Sales' quick filter shortcuts (L5): each one is a set of ordinary filters,
// with dates worked out in the practice's own calendar (D29).
import { describe, expect, it } from "vitest";
import { salesShortcuts } from "@/shared/sales-shortcuts";

const LA = "America/Los_Angeles";

describe("salesShortcuts", () => {
  it("works out dates in the practice's calendar: 11pm Pacific on October 31 is still October", () => {
    expect(salesShortcuts(new Date("2026-11-01T06:00:00Z"), LA)).toEqual([
      { label: "Paid this month", params: { status: "paid", dateField: "paid", from: "2026-10-01", to: "2026-10-31" } },
      { label: "Paid last month", params: { status: "paid", dateField: "paid", from: "2026-09-01", to: "2026-09-30" } },
      { label: "Last 90 days", params: { dateField: "created", from: "2026-08-03", to: "2026-10-31" } },
      { label: "Waiting for payment", params: { status: "sent" } },
      { label: "Drafts", params: { status: "draft" } },
    ]);
  });

  it("goes back into last year in January", () => {
    const [, lastMonth] = salesShortcuts(new Date("2027-01-15T20:00:00Z"), LA);
    expect(lastMonth.params).toEqual({ status: "paid", dateField: "paid", from: "2026-12-01", to: "2026-12-31" });
  });

  it("knows February's length", () => {
    const [, lastMonth] = salesShortcuts(new Date("2028-03-10T20:00:00Z"), LA);
    expect(lastMonth.params).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });
});
