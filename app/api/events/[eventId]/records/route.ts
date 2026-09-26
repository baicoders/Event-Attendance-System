import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { StudentAttendanceRecord } from "@/globals/types/students";
import { err, ok } from "@/globals/utils/api";
import { fullName } from "@/globals/utils/formatting";
import { assertEventVisibility, requireAuth } from "@/globals/utils/auth";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import { respondWithError } from "@/globals/utils/httpError";
import type { Group } from "@prisma/client";

const sectionOf = (groups: Group[]): Group | null =>
  groups.find((g) => g.category === "SECTION") ?? null;

// Fetch attendance for an event.
// - default: records with a time-in, for the live table.
// - ?onlyNeedsReview=true: eligible records missing a time-in, for recovery.
// - ?includeAbsent=true: every currently-eligible student with present/absent
//   status, so a report's rows and its present/absent totals always agree
//   (both derived from the same current-eligibility set).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { includedGroups: true },
    });

    if (!event) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    assertEventVisibility(event, user);

    const includeAbsent =
      new URL(req.url).searchParams.get("includeAbsent") === "true";
    const onlyNeedsReview =
      new URL(req.url).searchParams.get("onlyNeedsReview") === "true";
    if (includeAbsent && onlyNeedsReview) {
      return NextResponse.json(err("Choose either the eligible roster or records needing review."), { status: 400 });
    }

    // Scope records to currently-eligible students so the present rows match
    // the header/summary stats (which also count present among current
    // eligibility). A student who became inactive or left the event's group
    // drops from both, keeping counts and visible rows consistent.
    const recordsWithStudent = await prisma.record.findMany({
      where: { eventId, student: buildEventStudentFilter(event),
        ...(onlyNeedsReview ? { timein: null } : !includeAbsent ? { timein: { not: null } } : {}) },
      include: { student: { include: { groups: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (!includeAbsent) {
      const records: StudentAttendanceRecord[] = recordsWithStudent.map((r) => {
        const s = r.student;
        return {
          id: r.id,
          eventId: r.eventId,
          studentId: r.studentId,
          fullName: fullName(s.firstName, s.middleName || "", s.lastName),
          schoolLevel: s.schoolLevel,
          section: sectionOf(s.groups),
          timein: r.timein ? r.timein.toISOString() : null,
          timeout: r.timeout ? r.timeout.toISOString() : null,
          status: r.timein ? "present" : "absent",
        };
      });

      return NextResponse.json(ok(records), { status: 200 });
    }

    // Report view: start from every currently-eligible student and mark each
    // present (has time-in) or absent (no time-in). Records for students who are no
    // longer eligible are intentionally excluded so rows match the stats.
    const recordByStudent = new Map(
      recordsWithStudent.map((r) => [r.studentId, r] as const),
    );

    const eligibleStudents = await prisma.student.findMany({
      where: buildEventStudentFilter(event),
      include: { groups: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const rows: StudentAttendanceRecord[] = eligibleStudents.map((s) => {
      const record = recordByStudent.get(s.id);
      return {
        id: record?.id ?? s.id,
        eventId,
        studentId: s.id,
        fullName: fullName(s.firstName, s.middleName || "", s.lastName),
        schoolLevel: s.schoolLevel,
        section: sectionOf(s.groups),
        timein: record?.timein ? record.timein.toISOString() : null,
        timeout: record?.timeout ? record.timeout.toISOString() : null,
        status: record?.timein ? "present" : "absent",
      };
    });

    return NextResponse.json(ok(rows), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
