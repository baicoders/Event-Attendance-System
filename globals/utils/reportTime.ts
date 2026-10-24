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

const scheduleDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE, year: "numeric", month: "short", day: "numeric",
});
const calendarDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", year: "numeric", month: "short", day: "numeric",
});
const scheduleClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true,
});

/** Human-readable print schedule; machine-readable export timestamps stay unchanged. */
export function formatReportEventSchedule(start: string | Date, end: string | Date, allDay: boolean): string {
  const from = new Date(start), to = new Date(end);
  const dateFormatter = allDay ? calendarDateFormatter : scheduleDateFormatter;
  const fromDate = dateFormatter.format(from), toDate = dateFormatter.format(to);
  if (allDay) {
    const dates = fromDate === toDate ? fromDate : from <= to
      ? dateFormatter.formatRange(from, to).replace(/\s+/g, " ")
      : `${fromDate} – ${toDate}`;
    return `${dates} · All day`;
  }
  const fromTime = scheduleClockFormatter.format(from), toTime = scheduleClockFormatter.format(to);
  return fromDate === toDate
    ? `${fromDate} · ${fromTime} – ${toTime}`
    : `${fromDate}, ${fromTime} – ${toDate}, ${toTime}`;
}
