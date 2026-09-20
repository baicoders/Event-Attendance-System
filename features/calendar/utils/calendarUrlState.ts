import type { CalendarView } from "@/features/calendar/types/calendar";

// Allowlisted, non-sensitive navigation context that is safe to keep in the URL.
// The default view matches FullCalendar's own default (month) so an absent
// `view` param keeps the calendar's current out-of-the-box behavior.
export const CALENDAR_VIEWS: CalendarView[] = [
  "dayGridMonth",
  "timeGridWeek",
  "timeGridDay",
];
export const DEFAULT_CALENDAR_VIEW: CalendarView = "dayGridMonth";

export const EVENT_FILTERS = [
  "current",
  "upcoming",
  "finished",
  "all",
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];
export const DEFAULT_EVENT_FILTER: EventFilter = "upcoming";

export const isValidCalendarView = (v: string | null): v is CalendarView =>
  !!v && (CALENDAR_VIEWS as string[]).includes(v);

export const isValidEventFilter = (v: string | null): v is EventFilter =>
  !!v && (EVENT_FILTERS as readonly string[]).includes(v);

// Strict YYYY-MM-DD that also has to be a real calendar date.
export const isValidYmd = (v: string | null): v is string => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // Round-trip guard against overflow like 2026-02-31.
  return formatYmd(d) === v;
};

// Local-time YYYY-MM-DD (avoids the UTC off-by-one from toISOString()).
export const formatYmd = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
