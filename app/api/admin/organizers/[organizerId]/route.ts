import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import { lockUserRowsForUpdate } from "@/globals/utils/credentials";
import { respondWithError } from "@/globals/utils/httpError";

const decisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().min(1).optional(),
});

/**
 * In-transaction recheck of the acting admin: still an ACTIVE ADMIN with no
 * forced password change pending and a session on the current credential
 * generation. Messages/codes mirror `globals/utils/auth` so a concurrent
 * demotion, deactivation, or credential change fails closed instead of
 * authorizing the review on a stale pre-lock snapshot.
 */
async function assertFreshAdmin(
  tx: {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique(args: any): Promise<any>;
    };
  },
  adminId: string,
  expectedCredentialVersion: number,
): Promise<void> {
  const freshAdmin = await tx.user.findUnique({
    where: { id: adminId },
    select: {
      role: true,
      status: true,
      mustChangePassword: true,
      credentialVersion: true,
    },
  });

  if (!freshAdmin) {
    throw new AuthError("Unauthorized", 401, "UNAUTHORIZED");
  }

  if (freshAdmin.credentialVersion !== expectedCredentialVersion) {
    throw new AuthError(
      "Session expired. Sign in again.",
      401,
      "UNAUTHORIZED",
    );
  }

  if (freshAdmin.role !== "ADMIN") {
    throw new AuthError("Forbidden", 403, "FORBIDDEN");
  }

  if (freshAdmin.status !== "ACTIVE") {
    throw new AuthError("Account not active", 403, "INACTIVE_USER");
  }

  if (freshAdmin.mustChangePassword) {
    throw new AuthError(
      "Password change required before using the application.",
      403,
      "PASSWORD_CHANGE_REQUIRED",
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ organizerId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const { organizerId } = await params;
    const { action, reason } = decisionSchema.parse(await req.json());

    const organizer = await prisma.user.findUnique({
      where: { id: organizerId },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!organizer || organizer.role !== "ORGANIZER") {
      return NextResponse.json(err("Organizer not found."), { status: 404 });
    }

    if (organizer.status !== "PENDING") {
      return NextResponse.json(
        err("Only pending organizers can be reviewed."),
        { status: 409 }
      );
    }

    if (action === "APPROVE") {
      // Guarded write: lock admin + organizer rows FOR UPDATE in
      // deterministic order, recheck admin authorization and the PENDING
      // precondition inside the same boundary, then write.
      const updated = await prisma.$transaction(async (tx) => {
        await lockUserRowsForUpdate(tx, [user.id, organizerId]);
        await assertFreshAdmin(tx, user.id, user.credentialVersion);

        const fresh = await tx.user.findUnique({
          where: { id: organizerId },
          select: {
            id: true,
            role: true,
            status: true,
          },
        });

        if (!fresh || fresh.role !== "ORGANIZER") return "missing" as const;
        if (fresh.status !== "PENDING") return "not-pending" as const;

        return tx.user.update({
          where: { id: organizerId },
          data: {
            status: "ACTIVE",
            rejectionReason: null,
          },
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            rejectionReason: true,
          },
        });
      });

      if (updated === "missing") {
        return NextResponse.json(err("Organizer not found."), { status: 404 });
      }

      if (updated === "not-pending") {
        return NextResponse.json(
          err("Only pending organizers can be reviewed."),
          { status: 409 }
        );
      }

      return NextResponse.json(ok(updated), { status: 200 });
    }

    if (!reason) {
      return NextResponse.json(err("Rejection reason is required."), {
        status: 400,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockUserRowsForUpdate(tx, [user.id, organizerId]);
      await assertFreshAdmin(tx, user.id, user.credentialVersion);

      const fresh = await tx.user.findUnique({
        where: { id: organizerId },
        select: {
          id: true,
          role: true,
          status: true,
        },
      });

      if (!fresh || fresh.role !== "ORGANIZER") return "missing" as const;
      if (fresh.status !== "PENDING") return "not-pending" as const;

      return tx.user.update({
        where: { id: organizerId },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          rejectionReason: true,
        },
      });
    });

    if (updated === "missing") {
      return NextResponse.json(err("Organizer not found."), { status: 404 });
    }

    if (updated === "not-pending") {
      return NextResponse.json(
        err("Only pending organizers can be reviewed."),
        { status: 409 }
      );
    }

    return NextResponse.json(ok(updated), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
