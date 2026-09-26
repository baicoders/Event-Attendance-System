import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import {
  BULK_MUTATION_JSON_LIMIT_BYTES,
  bulkCommitSchema,
} from "@/globals/schemas/studentBulk";
import {
  BulkTokenError,
  buildBulkPreviewRows,
  verifyBulkPreviewToken,
} from "@/globals/utils/studentBulk";
import { reviewFingerprint } from "@/globals/utils/studentContentVersion";
import { projectStudentContent, contentVersion } from "@/globals/utils/studentContentVersion";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";

const COMMIT_TIMEOUT_MS = 30_000;
const COMMIT_MAX_WAIT_MS = 10_000;

export async function POST(req: Request) {
  try {
    const user = await requireAuth();

    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > BULK_MUTATION_JSON_LIMIT_BYTES) {
      return NextResponse.json(err("Request is too large.", "PAYLOAD_TOO_LARGE"), {
        status: 413,
      });
    }
    const validated = bulkCommitSchema.parse(raw ? JSON.parse(raw) : {});

    let token;
    try {
      token = verifyBulkPreviewToken(validated.previewToken, user.id);
    } catch (e) {
      if (e instanceof BulkTokenError) {
        return NextResponse.json(err(e.message, e.code), { status: e.status });
      }
      throw e;
    }

    const category = token.targetCategory;

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Bulk membership replacement freezes eligibility (exclusive form).
          await takeRosterExclusiveLock(tx);
          const target = await tx.group.findUnique({
            where: { id: token.targetId },
            select: { id: true, slug: true, name: true, category: true },
          });
          if (!target) {
            throw new BulkTokenError("Target group no longer exists.", "TARGET_CHANGED", 409);
          }
          if (
            target.category !== category ||
            target.slug !== token.targetSlug ||
            target.id !== token.targetId
          ) {
            throw new BulkTokenError(
              "Target group changed since preview. Review again.",
              "TARGET_CHANGED",
              409,
            );
          }

          const students = await tx.student.findMany({
            where: { id: { in: token.studentIds } },
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

          const foundIds = new Set(students.map((s) => s.id));
          const missing = token.studentIds.filter((id) => !foundIds.has(id));
          if (missing.length > 0) {
            const error = new BulkTokenError(
              `${missing.length} selected student(s) no longer exist. Review again.`,
              "SELECTION_STALE",
              409,
            ) as BulkTokenError & { issues?: unknown };
            error.issues = missing.map((id) => ({
              id,
              reason: "Student no longer exists. Remove from selection.",
              reasonCode: "STUDENT_NOT_FOUND",
            }));
            throw error;
          }

          // Compare content versions before any write.
          const currentVersions: Record<string, string> = {};
          for (const s of students) {
            currentVersions[s.id] = contentVersion(
              projectStudentContent({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                middleName: s.middleName,
                schoolLevel: s.schoolLevel,
                yearLevel: s.yearLevel,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                groups: s.groups.map((g) => ({
                  id: g.id,
                  slug: g.slug,
                  category: g.category as never,
                })),
              }),
            );
          }
          const stale = token.studentIds.filter(
            (id) => currentVersions[id] !== token.contentVersions[id],
          );
          if (stale.length > 0) {
            const error = new BulkTokenError(
              "Roster changed since preview. Review again.",
              "SELECTION_STALE",
              409,
            ) as BulkTokenError & { issues?: unknown };
            error.issues = stale.map((id) => ({
              id,
              reason: "Student changed since preview. Review again.",
              reasonCode: "STALE",
            }));
            throw error;
          }

          // Review fingerprint catches renames that leave content versions intact.
          const studentsById = new Map(students.map((s) => [s.id, s]));
          const built = buildBulkPreviewRows({
            orderedIds: token.studentIds,
            studentsById,
            target: { id: target.id, slug: target.slug, name: target.name, category },
            action: token.action,
          });
          const fingerprint = reviewFingerprint({
            targetId: target.id,
            targetSlug: target.slug,
            targetName: target.name,
            targetCategory: category,
            beforeLabels: built.beforeLabels,
          });
          if (fingerprint !== token.reviewFingerprint) {
            throw new BulkTokenError(
              "Group labels changed since preview. Review again.",
              "TARGET_CHANGED",
              409,
            );
          }
          if (built.counts.blocked > 0) {
            const error = new BulkTokenError(
              `${built.counts.blocked} of ${token.studentIds.length} students need attention. No changes made.`,
              "SELECTION_STALE",
              409,
            ) as BulkTokenError & { issues?: unknown };
            error.issues = built.rows
              .filter((r) => r.status === "BLOCKED")
              .map((r) => ({ id: r.id, reason: r.reason, reasonCode: r.reasonCode }));
            throw error;
          }

          const changedIds: string[] = [];
          const unchangedIds: string[] = [];
          for (const row of built.rows) {
            if (row.status === "UNCHANGED") {
              unchangedIds.push(row.id);
              continue;
            }
            if (row.status !== "CHANGE") continue;
            const student = studentsById.get(row.id)!;
            const oldInCategory = student.groups.filter((g) => g.category === category);
            const disconnect =
              oldInCategory.length === 1 && oldInCategory[0].id !== target.id
                ? [{ id: oldInCategory[0].id }]
                : oldInCategory.length === 0
                  ? []
                  : [];
            // `before` already guarantees at most one membership and that it
            // differs from the target, so `disconnect` is either empty (no
            // prior membership) or the single stale membership.
            await tx.student.update({
              where: { id: row.id },
              data: {
                groups: {
                  ...(disconnect.length > 0 ? { disconnect } : {}),
                  connect: [{ id: target.id }],
                },
              },
            });
            changedIds.push(row.id);
          }

          return {
            changedIds: [...changedIds].sort(),
            unchangedIds: [...unchangedIds].sort(),
            target: { id: target.id, slug: target.slug, name: target.name, category },
          };
        },
        { timeout: COMMIT_TIMEOUT_MS, maxWait: COMMIT_MAX_WAIT_MS },
      );

      return NextResponse.json(
        ok({
          changedIds: result.changedIds,
          unchangedIds: result.unchangedIds,
          committedAt: new Date().toISOString(),
          target: result.target,
        }),
        { status: 200, headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      if (e instanceof BulkTokenError) {
        const withIssues = e as BulkTokenError & { issues?: unknown };
        return NextResponse.json(
          { ...err(e.message, e.code), issues: withIssues.issues ?? [] },
          { status: e.status },
        );
      }
      // Bounded busy/conflict failure: surface as 503 without retrying.
      const message = e instanceof Error ? e.message : "";
      if (/P2028|timed out|busy|database.*locked/i.test(message)) {
        return NextResponse.json(err("Database is busy. Try again.", "DATABASE_BUSY"), {
          status: 503,
        });
      }
      throw e;
    }
  } catch (error) {
    return respondWithError(error);
  }
}
