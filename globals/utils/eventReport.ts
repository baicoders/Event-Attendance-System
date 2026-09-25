import "server-only";

import type { Group, Record as AttendanceRecord, Student } from "@prisma/client";
import { prisma } from "@/globals/libs/prisma";
import {
  ARRIVAL_BUCKET_MINUTES,
  MAX_ARRIVAL_BUCKETS,
} from "@/globals/constants/attendance";
import type {
  ArrivalBucket,
  EventReport,
  ReportEvent,
  ReportRow,
  ReportTotals,
  SectionBreakdown,
} from "@/globals/types/reports";
import {
  attendanceRate,
  deriveOutcome,
  expectsTimeout as computeExpectsTimeout,
  hasNoTimeout,
} from "@/globals/utils/attendance";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import { fullName } from "@/globals/utils/formatting";
import { assertActiveUser, assertEventVisibility, AuthError, type AuthSession } from "@/globals/utils/auth";
import { bucketForStudent, GROUP_DIMENSIONS, summarizeGroups } from "@/globals/utils/reportGroups";
import { REPORT_TIME_ZONE } from "@/globals/utils/reportTime";

/**
 * The single source of truth for one event's attendance report.
 *
 * Both consumers go through here:
 *
 * - `GET /api/reports/events/[eventId]` — the on-screen report
 * - `app/(print)/reports/events/[id]/print` — the printable attendance sheet
 *
 * That is the point. The print page used to query Prisma and recompute
 * eligibility and totals on its own, which `docs/conventions.md` called "the
 * single most important 'these two things must be changed together' relationship
 * in the codebase" — the screen and the paper could silently disagree. They now
 * cannot: there is one query, one set of totals, one verdict per student.
 *
 * @see globals/utils/attendance.ts — the derivation rules
 * @see docs/plans/reports-overhaul.md
 */

/**
 * The `include` that produces a {@link ReportEvent}.
 *
 * `createdBy` is narrowed to id + name rather than included wholesale: this
 * report is serialized to the client, and `include: { createdBy: true }` would
 * ship the organizer's **password hash** in the JSON. Use this at every call site.
 */
export const REPORT_EVENT_INCLUDE = {
  includedGroups: true,
  createdBy: { select: { id: true, name: true } },
} as const;

type ReportStudent = Student & { groups: Group[] };
export type EventReportSnapshot = {
  event: ReportEvent;
  students: ReportStudent[];
  records: AttendanceRecord[];
  evaluatedAt: string;
};

export class ReportAudienceTooLargeError extends Error {}

/** Capture event visibility, current audience and records in one SQLite read transaction. */
export async function loadAuthorizedEventReportSnapshot(
  eventId: string,
  user: AuthSession,
  maxStudents?: number,
): Promise<EventReportSnapshot | null> {
  return prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, status: true } });
    if (!currentUser) throw new AuthError("Unauthorized", 401, "UNAUTHORIZED");
    const viewer = { ...user, ...currentUser };
    assertActiveUser(viewer);
    const event = await tx.event.findUnique({ where: { id: eventId }, include: REPORT_EVENT_INCLUDE });
    if (!event) return null;
    assertEventVisibility(event, viewer);
    const eligibleFilter = buildEventStudentFilter(event);
    if (maxStudents !== undefined && await tx.student.count({ where: eligibleFilter }) > maxStudents) {
      throw new ReportAudienceTooLargeError("Event audience exceeds the export limit.");
    }
    const students = await tx.student.findMany({
      where: eligibleFilter,
      include: { groups: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { middleName: "asc" }, { id: "asc" }],
      take: maxStudents === undefined ? undefined : maxStudents + 1,
    });
    if (maxStudents !== undefined && students.length > maxStudents) throw new ReportAudienceTooLargeError("Event audience exceeds the export limit.");
    const records = await tx.record.findMany({
      where: { eventId, student: eligibleFilter },
    });
    return { event, students, records, evaluatedAt: new Date().toISOString() };
  });
}

const BUCKET_MS = ARRIVAL_BUCKET_MINUTES * 60_000;

const floorToBucket = (date: Date): number =>
  Math.floor(date.getTime() / BUCKET_MS) * BUCKET_MS;

/**
 * Arrival counts per {@link ARRIVAL_BUCKET_MINUTES} window, in chronological order.
 *
 * Empty buckets between the first and last arrival are filled so a gap reads as
 * "nobody arrived" instead of collapsing into a misleadingly continuous bar
 * chart. A stray scan hours later would make that series unbounded, so filling is
 * skipped once the span exceeds {@link MAX_ARRIVAL_BUCKETS} and the sparse points
 * are returned as-is.
 */
function buildArrivals(timeins: Date[]): ArrivalBucket[] {
  if (timeins.length === 0) return [];

  const counts = new Map<number, number>();
  for (const timein of timeins) {
    const bucket = floorToBucket(timein);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const stamps = [...counts.keys()].sort((a, b) => a - b);
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  const span = (last - first) / BUCKET_MS + 1;

  if (span > MAX_ARRIVAL_BUCKETS) {
    return stamps.map((stamp) => ({
      bucketStart: new Date(stamp).toISOString(),
      count: counts.get(stamp) ?? 0,
    }));
  }

  const filled: ArrivalBucket[] = [];
  for (let stamp = first; stamp <= last; stamp += BUCKET_MS) {
    filled.push({
      bucketStart: new Date(stamp).toISOString(),
      count: counts.get(stamp) ?? 0,
    });
  }
  return filled;
}

/** Build a complete report from one previously authorized transaction snapshot. */
export function buildEventReport(snapshot: EventReportSnapshot): EventReport {
  const { event, students, records, evaluatedAt } = snapshot;

  const recordByStudent = new Map(records.map((r) => [r.studentId, r] as const));
  const expectsTimeout = computeExpectsTimeout(event, records);

  const totals: ReportTotals = {
    eligible: students.length,
    present: 0,
    late: 0,
    absent: 0,
    attended: 0,
    noTimeout: 0,
    scanned: 0,
    manual: 0,
  };

  const sections = new Map<string, SectionBreakdown>();
  const timeins: Date[] = [];
  const groupedEntries: { student: ReportStudent; outcome: ReportRow["outcome"] }[] = [];

  const rows: ReportRow[] = students.map((student) => {
    const record = recordByStudent.get(student.id);
    const outcome = deriveOutcome(record, event);
    const noTimeout = hasNoTimeout(record, expectsTimeout);
    const sectionBucket = bucketForStudent(student, "SECTION");
    const sectionName = sectionBucket.key === "none" ? null : sectionBucket.label;
    const reviewFlags: string[] = [];
    if (record && !record.timein) reviewFlags.push("MISSING_TIME_IN");
    if (record?.timein && record.timeout && record.timeout < record.timein) reviewFlags.push("INVALID_TIME_ORDER");
    groupedEntries.push({ student, outcome });

    if (outcome === "PRESENT") totals.present += 1;
    if (outcome === "LATE") totals.late += 1;
    if (outcome === "ABSENT") totals.absent += 1;
    if (outcome !== "ABSENT") totals.attended += 1;
    if (noTimeout) totals.noTimeout += 1;

    if (record?.method === "SCANNED") totals.scanned += 1;
    if (record?.method === "MANUAL") totals.manual += 1;
    if (record?.timein) timeins.push(record.timein);

    const key = sectionBucket.key;
    const bucket = sections.get(key) ?? {
      key,
      name: sectionBucket.label,
      eligible: 0,
      present: 0,
      late: 0,
      absent: 0,
    };
    bucket.eligible += 1;
    if (outcome === "PRESENT") bucket.present += 1;
    if (outcome === "LATE") bucket.late += 1;
    if (outcome === "ABSENT") bucket.absent += 1;
    sections.set(key, bucket);

    return {
      recordId: record?.id ?? null,
      studentId: student.id,
      fullName: fullName(
        student.firstName,
        student.middleName || "",
        student.lastName,
        "last",
      ),
      schoolLevel: student.schoolLevel,
      yearLevel: student.yearLevel,
      section: sectionName,
      sectionKey: key,
      timein: record?.timein ? record.timein.toISOString() : null,
      timeout: record?.timeout ? record.timeout.toISOString() : null,
      method: record?.method ?? null,
      outcome,
      noTimeout,
      reviewFlags,
    };
  });

  // Synthetic buckets sort last, even if a real section shares their label.
  const bySection = [...sections.values()].sort((a, b) => {
    const order = (key: string) => key === "none" ? 1 : key === "multiple" ? 2 : 0;
    return order(a.key) - order(b.key) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });

  const byGroup = Object.fromEntries(GROUP_DIMENSIONS.map((dimension) => [dimension, summarizeGroups(groupedEntries, dimension)])) as EventReport["byGroup"];

  return {
    evaluatedAt,
    timeZone: REPORT_TIME_ZONE,
    populationBasis: "CURRENT_ROSTER",
    event,
    expectsTimeout,
    totals,
    rate: attendanceRate(totals.attended, totals.eligible),
    arrivals: buildArrivals(timeins),
    bySection,
    byGroup,
    rows,
  };
}
