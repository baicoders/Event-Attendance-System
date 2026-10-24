import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { err, ok } from "@/globals/utils/api";
import { assertEventVisibility, requireAuth } from "@/globals/utils/auth";
import { buildStudentQuery } from "@/globals/utils/queryBuilder";
import { createStudentRecord } from "@/globals/utils/studentCreate";
import { resolveStudentIdentity } from "@/globals/utils/studentIdentity";
import { respondWithError } from "@/globals/utils/httpError";
import { flattenStudentGroups } from "@/globals/utils/students";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";

export async function POST(request: NextRequest) {
  try {
    // Policy: any active, authenticated user may manage the student roster
    // (create/edit/delete) - intentionally broader than event-deletion and
    // organizer-approval, which require ownership/admin. requireAuth already
    // enforces active status.
    await requireAuth();
    const payload = await request.json();
    // Legacy callers supplied USN as id. New records always get a generated internal ID.
    const input = { ...payload, usn: payload.usn ?? (payload.id?.length === 11 ? payload.id : undefined) };
    const student = await createStudentRecord(prisma, input);

    return NextResponse.json(ok(student), { status: 200 });
  } catch (error) {
    // A repeat student ID is a user error, not a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        err("A student with that ID already exists.", "DUPLICATE"),
        { status: 409 }
      );
    }

    return respondWithError(error);
  }
}

const querySchema = z.object({
  // Single fetch params
  studentId: z.string().optional(),
  eventId: z.string().trim().min(1).optional(),

  // Bulk filter params
  category: z.enum(["SHS", "COLLEGE", "HOUSE", "ALL"]).optional(),
  department: z.string().optional(),
  program: z.string().optional(),
  strand: z.string().optional(),
  house: z.string().optional(),
  customGroupId: z.string().trim().min(1).optional(),
});

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;

  try {
    // Roster reads carry student PII, so they are authenticated too.
    const user = await requireAuth();
    const result = querySchema.parse(Object.fromEntries(searchParams));

    const { studentId, eventId, ...filters } = result;

    // Single Student Fetch (Scoped by Event or Absolute)
    if (studentId) {
      let eventFilter = {};

      if (eventId) {
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          include: { includedGroups: true },
        });

        if (!event) {
          return NextResponse.json(err("Event not found"), { status: 404 });
        }
        assertEventVisibility(event, user);
        eventFilter = buildEventStudentFilter(event);
      }

      const canonicalId = await resolveStudentIdentity(prisma, studentId);
      const rawStudent = canonicalId ? await prisma.student.findFirst({
        where: {
          id: canonicalId,
          ...eventFilter,
        },
        include: { groups: true },
      }) : null;

      if (!rawStudent) {
        return NextResponse.json(err("Student not found or not included in the groups selected for this event."), {
          status: 404,
        });
      }

      return NextResponse.json(ok(flattenStudentGroups(rawStudent)));
    }

    // Bulk Student Fetch (List View).
    // When an eventId is supplied (manual-attendance list) the result must be
    // scoped to the event's eligible students, not the whole roster. Otherwise
    // fall back to the category/group filters used by the Student List.
    let where = buildStudentQuery(filters);

    if (eventId) {
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { includedGroups: true },
      });

      if (!event) {
        return NextResponse.json(err("Event not found"), { status: 404 });
      }
      assertEventVisibility(event, user);

      where = { ...where, ...buildEventStudentFilter(event) };
    }

    const rawStudents = await prisma.student.findMany({
      where,
      include: { groups: true },
      orderBy: { lastName: "asc" },
    });

    const students = rawStudents.map(flattenStudentGroups);
    return NextResponse.json(ok(students));
  } catch (error) {
    return respondWithError(error);
  }
}
