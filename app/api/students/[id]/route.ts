import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { flattenStudentGroups } from "@/globals/utils/students";
import { respondWithError } from "@/globals/utils/httpError";
import { studentSchema } from "@/globals/schemas/studentSchema";
import { studentEditVersion } from "@/globals/utils/studentDetail";
import { updateStudentDetail } from "@/globals/utils/studentEdit";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";

const privateHeaders = { "Cache-Control": "private, no-store" };
const editFields = new Set(["id", "firstName", "lastName", "middleName", "schoolLevel", "yearLevel", "section", "house", "department", "program", "strand"]);

// Fetching a single student by id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Student records are PII; reads require an authenticated, active user.
    await requireAuth();
    const { id } = await params;

    const rawStudent = await prisma.student.findUnique({
      where: { id },
      include: { groups: true },
    });

    if (!rawStudent) {
      return NextResponse.json(err("Student not found."), { status: 404, headers: privateHeaders });
    }

    return NextResponse.json(ok({ ...flattenStudentGroups(rawStudent), editVersion: studentEditVersion(rawStudent) }), {
      status: 200, headers: privateHeaders,
    });
  } catch (error) {
    const response = respondWithError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireAuth();
    const { id } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "expectedVersion" && key !== "student")) {
      return NextResponse.json(err("Invalid edit request.", "INVALID_STUDENT_EDIT"), { status: 400, headers: privateHeaders });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedVersion) ||
        !input.student || typeof input.student !== "object" || Array.isArray(input.student) ||
        Object.keys(input.student).some(key => !editFields.has(key))) {
      return NextResponse.json(err("Invalid edit request.", "INVALID_STUDENT_EDIT"), { status: 400, headers: privateHeaders });
    }
    const student = studentSchema.parse(input.student);
    if (student.id !== id) {
      return NextResponse.json(err("Student ID cannot be changed.", "STUDENT_ID_MISMATCH"), { status: 400, headers: privateHeaders });
    }
    const result = await updateStudentDetail(prisma, id, { expectedVersion: input.expectedVersion, student, principalId: principal.id });
    if (result.kind === "forbidden") return NextResponse.json(err("Account not active.", "INACTIVE_USER"), { status: 403, headers: privateHeaders });
    if (result.kind === "not-found") return NextResponse.json(err("Student not found.", "STUDENT_NOT_FOUND"), { status: 404, headers: privateHeaders });
    if (result.kind === "conflict") return NextResponse.json(err("This student changed after the editor opened. Reload the current record before saving.", "STUDENT_EDIT_CONFLICT"), { status: 409, headers: privateHeaders });
    if (result.kind === "group-review") return NextResponse.json(err("Group assignments require review before this profile can be edited.", "STUDENT_GROUP_REVIEW_REQUIRED"), { status: 409, headers: privateHeaders });
    if (result.kind === "invalid-groups") return NextResponse.json(err(result.message, "INVALID_GROUPS"), { status: 400, headers: privateHeaders });
    return NextResponse.json(ok({ ...result.student, changed: result.changed }), { status: 200, headers: privateHeaders });
  } catch (error) {
    const response = respondWithError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Deleting a student is a roster mutation; gate it behind auth.
    await requireAuth();
    const { id } = await params;

    const blocked = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      const attendanceCount = await tx.record.count({ where: { studentId: id } });
      if (attendanceCount > 0) return true;
      await tx.student.delete({ where: { id } });
      return false;
    });
    if (blocked) {
      return NextResponse.json(
        err(
          "Cannot delete this student because attendance has already been recorded for them.",
          "STUDENT_HAS_RECORDS"
        ),
        { status: 409 }
      );
    }
    return NextResponse.json(ok(null), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
