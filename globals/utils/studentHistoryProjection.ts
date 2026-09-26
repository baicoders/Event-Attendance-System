import { attendanceRate, deriveOutcome } from "./attendance";
import { isStudentInEvent } from "./buildEventStudentFilter";
import type { HistoryOutcomeFilter, HistoryView, StudentHistoryRow } from "../types/studentHistory";
import type { EventCategory, SchoolLevel } from "@prisma/client";

type StudentInput = { id: string; firstName: string; lastName: string; middleName: string | null;
  schoolLevel: SchoolLevel; groups: ReadonlyArray<{ slug: string; name: string; category: EventCategory }> };
type EventInput = { id: string; title: string; category: EventCategory; start: Date; end: Date;
  allDay: boolean; includedGroups: ReadonlyArray<{ slug: string }> };
type RecordInput = { id: string; eventId: string; timein: Date | null; timeout: Date | null; method: string };

export function projectStudentHistory(input: {
  student: StudentInput; events: ReadonlyArray<EventInput>; records: ReadonlyArray<RecordInput>;
  todayStart: Date; view: HistoryView; outcome: HistoryOutcomeFilter; search: string;
  page: number; pageSize: number; evaluatedAt?: Date;
}) {
  const recordsByEvent = new Map(input.records.map(record => [record.eventId, record]));
  const allRows: StudentHistoryRow[] = input.events.map(event => {
    const record = recordsByEvent.get(event.id);
    const eligible = isStudentInEvent(input.student, event);
    const validSchedule = Number.isFinite(event.start.getTime()) && Number.isFinite(event.end.getTime()) && event.end >= event.start;
    const counted = eligible && validSchedule && event.start < input.todayStart && event.end < input.todayStart;
    const derivedOutcome = deriveOutcome(record, event);
    const displayState = !validSchedule ? "REVIEW_REQUIRED" : record && !record.timein ? "INCOMPLETE_RECORD" :
      record?.timein ? derivedOutcome === "LATE" ? "LATE" : "PRESENT" : counted ? "ABSENT_CURRENT_ROSTER" :
      event.start > (input.evaluatedAt ?? new Date()) ? "NOT_STARTED" : "NOT_YET_CHECKED_IN";
    return {
      eventId: event.id, title: event.title, category: event.category,
      start: event.start.toISOString(), end: event.end.toISOString(), allDay: event.allDay,
      recordId: record?.id ?? null, timein: record?.timein?.toISOString() ?? null,
      timeout: record?.timeout?.toISOString() ?? null, method: record?.method ?? null,
      currentlyEligible: eligible, countedInComparison: counted, derivedOutcome, displayState,
      comparisonExclusionReason: !validSchedule ? "INVALID_SCHEDULE" : !eligible ? "OUTSIDE_CURRENT_AUDIENCE" :
        !counted ? "NOT_BEFORE_TODAY" : null,
    } satisfies StudentHistoryRow;
  });
  const recorded = allRows.filter(row => row.recordId !== null);
  const comparison = allRows.filter(row => row.currentlyEligible);
  const comparisonEvents = comparison.filter(row => row.countedInComparison);
  const comparisonAttended = comparisonEvents.filter(row => row.timein !== null).length;
  const summary = {
    recordedRows: recorded.length,
    recordedTimeIns: recorded.filter(row => row.timein !== null).length,
    incompleteRecordedRows: recorded.filter(row => row.timein === null).length,
    recordedTimeInsOutsideCurrentScope: recorded.filter(row => row.timein !== null && !row.currentlyEligible).length,
    comparisonEvents: comparisonEvents.length,
    comparisonAttended,
    comparisonAbsent: comparisonEvents.length - comparisonAttended,
    comparisonRatePercent: attendanceRate(comparisonAttended, comparisonEvents.length),
    excludedFromComparison: comparison.length - comparisonEvents.length,
  };
  const population = input.view === "recorded" ? recorded : comparison;
  const searched = population.filter(row => row.title.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()) &&
    (input.outcome === "all" ||
      (input.outcome === "attended" && row.timein !== null) ||
      (input.outcome === "late" && row.timein !== null && row.derivedOutcome === "LATE") ||
      (input.outcome === "missing" && row.timein === null)));
  searched.sort((a, b) => b.start.localeCompare(a.start) || a.eventId.localeCompare(b.eventId));
  const page = Math.min(input.page, Math.max(1, Math.ceil(searched.length / input.pageSize)));
  return { summary, rows: searched.slice((page - 1) * input.pageSize, page * input.pageSize),
    rowCount: searched.length, page, pageSize: input.pageSize };
}
