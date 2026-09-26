import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import {
  BULK_MUTATION_JSON_LIMIT_BYTES,
  bulkPreviewSchema,
  type BulkAction,
} from "@/globals/schemas/studentBulk";
import {
  buildBulkPreviewRows,
  buildBulkTokenPayload,
  signBulkPreviewToken,
} from "@/globals/utils/studentBulk";
import type { BulkPreviewTarget } from "@/globals/types/studentBulk";

const PREVIEW_READ_TIMEOUT_MS = 15_000;

function actionToCategory(action: BulkAction): "SECTION" | "HOUSE" {
  return action === "SET_SECTION" ? "SECTION" : "HOUSE";
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();

    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > BULK_MUTATION_JSON_LIMIT_BYTES) {
      return NextResponse.json(err("Selection is too large.", "PAYLOAD_TOO_LARGE"), {
        status: 413,
      });
    }
    const validated = bulkPreviewSchema.parse(raw ? JSON.parse(raw) : {});

    const orderedIds = [...new Set(validated.studentIds.map((id) => id.trim()))].sort();
    const category = actionToCategory(validated.action);

    const snapshot = await prisma.$transaction(
      async (tx) => {
        const target = await tx.group.findUnique({
          where: { id: validated.targetGroupId },
          select: { id: true, slug: true, name: true, category: true },
        });
        const students = await tx.student.findMany({
          where: { id: { in: orderedIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            middleName: true,
            schoolLevel: true,
            yearLevel: true,
            createdAt: true,
            updatedAt: true,
            groups: { select: { id: true, slug: true, name: true, category: true } },
          },
        });
        return { target, students };
      },
      { timeout: PREVIEW_READ_TIMEOUT_MS, maxWait: 5_000 },
    );

    if (!snapshot.target) {
      return NextResponse.json(err("Target group no longer exists.", "UNKNOWN_TARGET"), {
        status: 404,
      });
    }
    if (snapshot.target.category !== category) {
      return NextResponse.json(
        err(`Target is a ${snapshot.target.category.toLowerCase()}, not a ${category.toLowerCase()}.`, "INVALID_TARGET"),
        { status: 400 },
      );
    }

    const target: BulkPreviewTarget = {
      id: snapshot.target.id,
      slug: snapshot.target.slug,
      name: snapshot.target.name,
      category,
    };

    const studentsById = new Map(snapshot.students.map((s) => [s.id, s]));
    const built = buildBulkPreviewRows({
      orderedIds,
      studentsById,
      target: { id: target.id, slug: target.slug, name: target.name, category: target.category },
      action: validated.action,
    });

    const preparedAt = new Date();
    const expiresAt = new Date(preparedAt.getTime() + 10 * 60 * 1000);

    const canCommit = built.counts.blocked === 0 && built.counts.changed > 0;
    const previewToken = canCommit
      ? signBulkPreviewToken(
          buildBulkTokenPayload({
            userId: user.id,
            orderedIds,
            action: validated.action,
            target,
            contentVersions: built.contentVersions,
            beforeLabels: built.beforeLabels,
            preparedAt: preparedAt.getTime(),
          }),
        )
      : null;

    return NextResponse.json(
      ok({
        selectionCount: orderedIds.length,
        changedCount: built.counts.changed,
        unchangedCount: built.counts.unchanged,
        blockedCount: built.counts.blocked,
        action: validated.action,
        target,
        rows: built.rows,
        preparedAt: preparedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        previewToken,
      }),
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
