// Dates are stored in UTC and shown in the practice's time zone (D29).

export function formatDate(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(date));
}

export function formatDateTime(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(date));
}
