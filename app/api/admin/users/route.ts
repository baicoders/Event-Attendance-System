import { NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";

/**
 * GET /api/admin/users
 *
 * Every user, whatever their role or status. `GET /api/admin/organizers` is
 * hard-filtered to PENDING organizers for the dashboard's approval queue and
 * stays that way; this is the operator console's full directory.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        rejectionReason: true,
        mustChangePassword: true,
        // Exposed so the reset dialog can send a fresh target revision as its
        // precondition. It does not authorize any action by itself.
        credentialVersion: true,
        createdAt: true,
      },
    });

    return NextResponse.json(ok(users), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
