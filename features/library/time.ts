import { formatReportDateTime } from "@/globals/utils/reportTime";

export const LIBRARY_CLOSING_CLOCK = "17:00";
export const LIBRARY_SCAN_COOLDOWN_MS = 10_000;
export const EMPLOYEES_GROUP_SLUG = "employees";
export type LibraryPeriod = "daily" | "weekly" | "monthly";

export function libraryDay(now = new Date()): string {
  return formatReportDateTime(now).slice(0, 10);
}

export function closingTime(day: string): Date {
  return new Date(`${day}T${LIBRARY_CLOSING_CLOCK}:00+08:00`);
}

export function libraryRange(day: string, period: LibraryPeriod) {
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error("Invalid calendar date");
  }
  const start = new Date(date);
  const end = new Date(date);
  if (period === "weekly") {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === "monthly") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

type StatusVisit = { visitDay: string; timeIn: Date | string; timeOut: Date | string | null; administrativelyClosedAt: Date | string | null };
export function visitStatus(visit: StatusVisit, now = new Date()): string {
  if (visit.timeOut) return visit.administrativelyClosedAt ? "Closed by librarian" : "Completed";
  const closing = closingTime(visit.visitDay);
  if (closing > now) return "Inside";
  return new Date(visit.timeIn) > closing ? "Individual review required" : "Missing Time Out";
}
