export const REPORT_TIME_ZONE = "Asia/Manila" as const;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatReportDateTime(value: string | Date | null): string {
  if (!value) return "";
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatReportClock(value: string | Date | null): string {
  return formatReportDateTime(value).slice(11, 16) || "—";
}

/** All-day event dates are stored as UTC midnight calendar dates. */
export function formatReportEventDate(value: string | Date, allDay: boolean): string {
  return allDay ? new Date(value).toISOString().slice(0, 10) : formatReportDateTime(value);
}
