import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";

/**
 * GET /api/groups/manage
 *
 * The operator console's group table. Unlike `GET /api/groups` - which is
 * public and shaped as form-select options - this returns one row per group
 * with the reference counts the delete flow needs, so it is admin only.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const groups = await prisma.group.findMany({
      where: { category: { not: "CUSTOM" } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        _count: { select: { students: true } },
        // Returned in full, not just counted: the delete flow has to name the
        // events an operator must retarget before the group can go.
        events: {
          select: { id: true, title: true, status: true },
          orderBy: { start: "desc" },
        },
      },
    });

    return NextResponse.json(
      ok(
        groups.map(({ _count, ...group }) => ({
          ...group,
          studentCount: _count.students,
          eventCount: group.events.length,
        })),
      ),
      { status: 200 },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
