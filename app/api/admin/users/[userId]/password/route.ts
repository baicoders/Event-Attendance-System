import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import { hashPassword, verifyPassword } from "@/globals/utils/password";
import {
  applyAdminPasswordReset,
  generateTemporaryPassword,
  lockUserRowsForUpdate,
} from "@/globals/utils/credentials";
import { rateLimit } from "@/globals/utils/rateLimit";

const resetSchema = z.object({
  adminPassword: z.string().min(1, "Admin password is required"),
  expectedCredentialVersion: z.number().int().nonnegative(),
});

/**
 * PATCH /api/admin/users/[userId]/password
 *
 * Admin-issued password recovery: the server generates a temporary password,
 * returns it exactly once, and flags the account so the user must replace it
 * before reaching the app. The admin never chooses the password, and it is
 * stored hashed.
 *
 * Safety contract: usable-admin authorization + current-password reauth +
 * fresh target-revision precondition. Self-targeting is rejected so the only
 * active admin session is never invalidated mid-delivery.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    // Default gate: must be a current-version, ACTIVE, non-forced-change
    // account before role is even considered.
    const admin = await requireAuth();
    requireRole(admin, "ADMIN");

    const { userId } = await params;
    const { adminPassword, expectedCredentialVersion } = resetSchema.parse(
      await req.json(),
    );

    if (admin.id === userId) {
      return NextResponse.json(
        err(
          "Use Change password for your own account instead of a reset.",
          "USE_CHANGE_PASSWORD",
        ),
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Bounded by actor/target, not one school-wide bucket.
    if (!rateLimit(`adminReset:${admin.id}:${userId}`, 10, 5 * 60_000)) {
      return NextResponse.json(
        err("Too many reset attempts. Try again in a few minutes."),
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }

    const [adminSnapshot, target] = await Promise.all([
      prisma.user.findUnique({
        where: { id: admin.id },
        select: {
          id: true,
          password: true,
          credentialVersion: true,
          role: true,
          status: true,
          mustChangePassword: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          credentialVersion: true,
        },
      }),
    ]);

    if (!adminSnapshot) {
      throw new AuthError("Unauthorized", 401, "UNAUTHORIZED");
    }

    if (adminSnapshot.credentialVersion !== admin.credentialVersion) {
      throw new AuthError(
        "Session expired. Sign in again.",
        401,
        "UNAUTHORIZED",
      );
    }

    if (!(await verifyPassword(adminPassword, adminSnapshot.password))) {
      return NextResponse.json(
        err("Admin password is incorrect.", "INVALID_CREDENTIALS"),
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!target) {
      return NextResponse.json(err("User not found.", "NOT_FOUND"), {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    // The reviewed revision must still match — a stale retry never overwrites
    // a password chosen in the meantime.
    if (target.credentialVersion !== expectedCredentialVersion) {
      return NextResponse.json(
        err(
          "User changed since you reviewed them. Reload and confirm again.",
          "CREDENTIALS_CHANGED",
        ),
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    // Hash outside the write so the conditional update below stays short.
    const tempHash = await hashPassword(temporaryPassword);

    // Guarded PostgreSQL reset: lock admin + target rows FOR UPDATE in
    // deterministic order, recheck current administrator authorization inside
    // the same boundary, then run the conditional reset + winning-generation
    // reread on that same transaction connection.
    const updated = await prisma.$transaction(async (tx) => {
      await lockUserRowsForUpdate(tx, [admin.id, target.id]);
      const freshAdmin = await tx.user.findUnique({
        where: { id: admin.id },
        select: {
          role: true,
          status: true,
          mustChangePassword: true,
          credentialVersion: true,
        },
      });

      if (
        !freshAdmin ||
        freshAdmin.role !== "ADMIN" ||
        freshAdmin.status !== "ACTIVE" ||
        freshAdmin.mustChangePassword ||
        freshAdmin.credentialVersion !== admin.credentialVersion
      ) {
        throw new AuthError("Forbidden", 403, "FORBIDDEN");
      }

      return applyAdminPasswordReset(tx, {
        targetId: target.id,
        expectedCredentialVersion: target.credentialVersion,
        tempPasswordHash: tempHash,
      });
    });

    if (!updated) {
      // A competing reset/replacement won between review and write. The first
      // displayed secret is not silently replaced.
      return NextResponse.json(
        err(
          "User changed since you reviewed them. Reload and confirm again.",
          "CREDENTIALS_CHANGED",
        ),
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      ok({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        temporaryPassword,
        credentialVersion: updated.credentialVersion,
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
