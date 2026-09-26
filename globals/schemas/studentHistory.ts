import type { HistoryOutcomeFilter, HistoryView } from "../types/studentHistory";
import { REPORT_TIME_ZONE, formatReportDateTime } from "../utils/reportTime";

export const HISTORY_TIME_ZONE = REPORT_TIME_ZONE;
export const HISTORY_EVENT_LIMIT = 1000;
const DAY = 86_400_000;
const allowedKeys = new Set(["view", "from", "to", "outcome", "search", "page", "pageSize"]);

export class HistoryQueryError extends Error {
  constructor(message: string, public code = "INVALID_HISTORY_QUERY", public status = 400) {
    super(message);
  }
}

export function schoolDate(instant: Date): string {
  return formatReportDateTime(instant).slice(0, 10);
}

function dateMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HistoryQueryError("Use real dates in YYYY-MM-DD format.");
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value)
    throw new HistoryQueryError("Use real dates in YYYY-MM-DD format.");
  return millis;
}

/** Asia/Manila has a fixed UTC+08:00 reporting boundary for the supported date range. */
export function schoolMidnight(value: string): Date {
  return new Date(dateMillis(value) - 8 * 60 * 60_000);
}

export function parseHistoryQuery(params: URLSearchParams, evaluatedAt = new Date()) {
  for (const key of params.keys()) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1)
      throw new HistoryQueryError("Unknown or repeated history filter.");
  }
  const today = schoolDate(evaluatedAt);
  const to = params.get("to") ?? today;
  const from = params.get("from") ?? new Date(dateMillis(today) - 89 * DAY).toISOString().slice(0, 10);
  const fromMs = dateMillis(from);
  const toMs = dateMillis(to);
  if (fromMs > toMs) throw new HistoryQueryError("The start date must be on or before the end date.");
  if ((toMs - fromMs) / DAY + 1 > 366) throw new HistoryQueryError("Choose at most 366 calendar dates.");
  const view = params.get("view") ?? "recorded";
  if (view !== "recorded" && view !== "current-roster") throw new HistoryQueryError("Invalid history view.");
  const outcome = params.get("outcome") ?? "all";
  if (!["all", "attended", "late", "missing"].includes(outcome)) throw new HistoryQueryError("Invalid outcome filter.");
  const search = (params.get("search") ?? "").trim();
  if (search.length > 100) throw new HistoryQueryError("Search is limited to 100 characters.");
  const pageText = params.get("page") ?? "1";
  const sizeText = params.get("pageSize") ?? "25";
  if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(Number(pageText))) throw new HistoryQueryError("Invalid page.");
  if (!["5", "10", "25", "50", "100"].includes(sizeText)) throw new HistoryQueryError("Invalid page size.");
  return { from, to, view: view as HistoryView, outcome: outcome as HistoryOutcomeFilter,
    search, page: Number(pageText), pageSize: Number(sizeText),
    fromInstant: schoolMidnight(from), toExclusive: new Date(schoolMidnight(to).getTime() + DAY),
    todayStart: schoolMidnight(today) };
}
