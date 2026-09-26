import "server-only";
import { prisma } from "../libs/prisma";
import { HISTORY_EVENT_LIMIT, HistoryQueryError, parseHistoryQuery } from "../schemas/studentHistory";
import { projectStudentHistory } from "./studentHistoryProjection";
import type { StudentHistoryResponse } from "../types/studentHistory";

export async function loadStudentHistory(studentId: string, query: ReturnType<typeof parseHistoryQuery>, evaluatedAt: Date): Promise<StudentHistoryResponse | null> {
  const snapshot = await prisma.$transaction(async tx => {
    const student = await tx.student.findUnique({ where: { id: studentId }, select: {
      id: true, firstName: true, lastName: true, middleName: true, schoolLevel: true,
      groups: { select: { slug: true, name: true, category: true } },
    } });
    if (!student) return null;
    const events = await tx.event.findMany({ where: { status: "APPROVED",
      start: { gte: query.fromInstant, lt: query.toExclusive } },
      orderBy: [{ start: "desc" }, { id: "asc" }], take: HISTORY_EVENT_LIMIT + 1,
      select: { id: true, title: true, category: true, start: true, end: true,
        allDay: true, includedGroups: { select: { slug: true } } },
    });
    if (events.length > HISTORY_EVENT_LIMIT)
      throw new HistoryQueryError("Too many events in this range. Choose a narrower date range.", "HISTORY_RANGE_TOO_LARGE", 422);
    const records = [] as Array<{ id: string; eventId: string; timein: Date | null; timeout: Date | null; method: string }>;
    for (let i = 0; i < events.length; i += 400) {
      records.push(...await tx.record.findMany({ where: { studentId, eventId: { in: events.slice(i, i + 400).map(e => e.id) } },
        select: { id: true, eventId: true, timein: true, timeout: true, method: true } }));
    }
    return { student, events, records };
  }, { maxWait: 2_000, timeout: 10_000, isolationLevel: "RepeatableRead" });
  if (!snapshot) return null;
  const projection = projectStudentHistory({ ...snapshot, todayStart: query.todayStart,
    view: query.view, outcome: query.outcome, search: query.search, page: query.page, pageSize: query.pageSize, evaluatedAt });
  const { student } = snapshot;
  return {
    student: { id: student.id, displayName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      schoolLevel: student.schoolLevel, groups: student.groups.map(g => g.name) },
    evaluatedAt: evaluatedAt.toISOString(), timeZone: "Asia/Manila",
    range: { from: query.from, to: query.to, basis: "EVENT_START_DATE" },
    view: query.view, comparisonBasis: "CURRENT_ROSTER_SCHEDULED_BEFORE_TODAY", ...projection,
  };
}
