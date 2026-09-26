import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";
import {
  deleteGroupSchema,
  updateGroupSchema,
} from "@/globals/schemas/groupSchema";

/** Reassigning a large section can touch thousands of join rows. */
const REASSIGN_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * PATCH /api/groups/[groupId]
 * Renames a group. Admin only. The slug is deliberately immutable.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const { groupId } = await params;
    const { name } = updateGroupSchema.parse(await req.json());

    const existing = await prisma.group.findUnique({ where: { id: groupId } });
    if (!existing) {
      return NextResponse.json(err("Group not found.", "NOT_FOUND"), {
        status: 404,
      });
    }

    const group = await prisma.group.update({
      where: { id: groupId },
      data: { name },
      select: { id: true, name: true, slug: true, category: true },
    });

    return NextResponse.json(ok(group), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * DELETE /api/groups/[groupId]
 *
 * Admin only. Refuses while any event targets the group: the join rows cascade,
 * so deleting anyway would silently rewrite that event's audience. Students are
 * moved to `reassignToGroupId` when one is given, or left without a group of
 * this category when it is null.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const { groupId } = await params;

    // DELETE bodies are optional; an empty one means "no reassignment".
    const raw = await req.text();
    const { reassignToGroupId } = deleteGroupSchema.parse(
      raw ? JSON.parse(raw) : {},
    );

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        category: true,
        students: { select: { id: true } },
        events: { select: { id: true, title: true, status: true } },
      },
    });

    if (!group) {
      return NextResponse.json(err("Group not found.", "NOT_FOUND"), {
        status: 404,
      });
    }

    if (group.events.length > 0) {
      return NextResponse.json(
        {
          ...err(
            `${group.events.length} event(s) target this group. Retarget them before deleting it.`,
            "GROUP_IN_USE_BY_EVENTS",
          ),
          events: group.events,
        },
        { status: 409 },
      );
    }

    if (reassignToGroupId) {
      if (reassignToGroupId === groupId) {
        return NextResponse.json(
          err("Cannot reassign a group's students to itself.", "INVALID_TARGET"),
          { status: 400 },
        );
      }

      const target = await prisma.group.findUnique({
        where: { id: reassignToGroupId },
        select: { id: true, category: true },
      });

      if (!target) {
        return NextResponse.json(
          err("Replacement group not found.", "INVALID_TARGET"),
          { status: 400 },
        );
      }

      // A student's group must match the category of the column that references
      // it, so a cross-category move would produce a roster the student write
      // path then rejects.
      if (target.category !== group.category) {
        return NextResponse.json(
          err(
            "Replacement group must be in the same category.",
            "INVALID_TARGET",
          ),
          { status: 400 },
        );
      }
    }

    const studentIds = group.students.map((student) => ({ id: student.id }));

    await prisma.$transaction(
      async (tx) => {
        // Roster maintenance takes the exclusive form: eligibility is frozen
        // across the reassignment/deletion while scans wait.
        await takeRosterExclusiveLock(tx);
        // Lock both groups in deterministic order before touching join rows.
        const ordered = [groupId, reassignToGroupId].filter((id): id is string => !!id).sort();
        for (const id of ordered) {
          await tx.$queryRaw`SELECT id FROM "Group" WHERE id = ${id} FOR UPDATE`;
        }
        if (reassignToGroupId && studentIds.length > 0) {
          await tx.group.update({
            where: { id: reassignToGroupId },
            data: { students: { connect: studentIds } },
          });
        }

        // Membership join rows cascade with the group.
        await tx.group.delete({ where: { id: groupId } });
      },
      {
        timeout: REASSIGN_TRANSACTION_TIMEOUT_MS,
        maxWait: REASSIGN_TRANSACTION_TIMEOUT_MS,
      },
    );

    return NextResponse.json(
      ok({
        id: groupId,
        reassignedStudents: reassignToGroupId ? studentIds.length : 0,
        unassignedStudents: reassignToGroupId ? 0 : studentIds.length,
      }),
      { status: 200 },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
