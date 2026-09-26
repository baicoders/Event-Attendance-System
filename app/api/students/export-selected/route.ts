import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import {
  BULK_EXPORT_JSON_LIMIT_BYTES,
  bulkExportSelectedSchema,
} from "@/globals/schemas/studentBulk";
import type { BulkExportRow } from "@/globals/types/studentBulk";

const EXPORT_READ_TIMEOUT_MS = 30_000;

function slugsFor(groups: Array<{ slug: string; category: string }>, category: string): string[] {
  return groups
    .filter((g) => g.category === category)
    .map((g) => g.slug)
    .sort();
}

export async function POST(req: Request) {
  try {
    await requireAuth();

    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > BULK_EXPORT_JSON_LIMIT_BYTES) {
      return NextResponse.json(err("Selection is too large.", "PAYLOAD_TOO_LARGE"), {
        status: 413,
      });
    }
    const validated = bulkExportSelectedSchema.parse(raw ? JSON.parse(raw) : {});
    const orderedIds = [...new Set(validated.studentIds.map((id) => id.trim()))].sort();

    const preparedAt = new Date();

    const students = await prisma.$transaction(
      async (tx) =>
        tx.student.findMany({
          where: { id: { in: orderedIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            middleName: true,
            schoolLevel: true,
            yearLevel: true,
            groups: { select: { slug: true, category: true } },
          },
        }),
      { timeout: EXPORT_READ_TIMEOUT_MS, maxWait: 10_000, isolationLevel: "RepeatableRead" },
    );

    const found = new Set(students.map((s) => s.id));
    const missingIds = orderedIds.filter((id) => !found.has(id));
    if (missingIds.length > 0) {
      return NextResponse.json(
        {
          ...err(
            `${missingIds.length} selected student(s) no longer exist. Refresh and try again.`,
            "SELECTION_STALE",
          ),
          missingIds,
        },
        { status: 409 },
      );
    }

    const rows: BulkExportRow[] = students.map((s) => ({
      studentId: s.id,
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName ?? "",
      schoolLevel: s.schoolLevel,
      yearLevel: s.yearLevel,
      sectionSlugs: slugsFor(s.groups, "SECTION"),
      houseSlugs: slugsFor(s.groups, "HOUSE"),
      departmentSlugs: slugsFor(s.groups, "DEPARTMENT"),
      programSlugs: slugsFor(s.groups, "PROGRAM"),
      strandSlugs: slugsFor(s.groups, "STRAND"),
      preparedAtUtc: preparedAt.toISOString(),
    }));

    rows.sort((a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.studentId.localeCompare(b.studentId),
    );

    return NextResponse.json(
      ok({
        preparedAt: preparedAt.toISOString(),
        selectionCount: orderedIds.length,
        schemaVersion: 1 as const,
        rows,
      }),
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
