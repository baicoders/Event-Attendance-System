import { NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import {
  AuthError,
  requireAuth,
  setAuthSession,
} from "@/globals/utils/auth";
import { hashPassword, verifyPassword } from "@/globals/utils/password";
import { applyOwnPasswordChange } from "@/globals/utils/credentials";
import { changePasswordSchema } from "@/features/auth/schema/changePasswordSchema";
import { rateLimit } from "@/globals/utils/rateLimit";

/**
 * POST /api/auth/change-password
 *
 * The one route a forced-change session may call besides session-read and
 * logout. `requireAuth({ allowForcedPasswordChange: true })` is a deliberate
 * server-only opt-in — never accept it from HTTP parameters.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuth({ allowForcedPasswordChange: true });
    const { currentPassword, newPassword } = changePasswordSchema.parse(
      await req.json(),
    );

    // Keyed by user, not by client address - the LAN deployment collapses
    // every device onto one X-Forwarded-For hop.
    if (!rateLimit(`changePassword:${session.id}`, 10, 5 * 60_000)) {
      return NextResponse.json(
        err("Too many attempts. Try again in a few minutes."),
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }

    const snapshot = await prisma.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        password: true,
        credentialVersion: true,
        status: true,
      },
    });

    if (!snapshot) {
      throw new AuthError("Unauthorized", 401, "UNAUTHORIZED");
    }

    // The cookie's generation must still match the stored generation whose
    // password is about to be verified — otherwise an earlier verification
    // is being replayed against a newer credential.
    if (snapshot.credentialVersion !== session.credentialVersion) {
      throw new AuthError(
        "Session expired. Sign in again.",
        401,
        "UNAUTHORIZED",
      );
    }

    if (!(await verifyPassword(currentPassword, snapshot.password))) {
      return NextResponse.json(
        err("Current password is incorrect.", "INVALID_CREDENTIALS"),
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Hash outside the write so the conditional update below stays short.
    const newHash = await hashPassword(newPassword);

    const updated = await applyOwnPasswordChange(prisma, {
      userId: snapshot.id,
      expectedCredentialVersion: snapshot.credentialVersion,
      verifiedPasswordHash: snapshot.password,
      newPasswordHash: newHash,
    });

    if (!updated) {
      // A competing reset/replacement won between verification and write.
      // Never attach the latest version to this stale verification.
      return NextResponse.json(
        err(
          "Password changed elsewhere. Sign in again with the latest password.",
          "CREDENTIALS_CHANGED",
        ),
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Only the winning request emits a cookie, for its exact new generation.
    await setAuthSession({
      id: updated.id as string,
      name: updated.name as string,
      email: updated.email as string,
      role: updated.role as "ADMIN" | "ORGANIZER",
      status: updated.status as "PENDING" | "ACTIVE" | "REJECTED",
      rejectionReason: (updated.rejectionReason as string | null) ?? null,
      mustChangePassword: updated.mustChangePassword as boolean,
      credentialVersion: updated.credentialVersion as number,
    });

    return NextResponse.json(ok(updated), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
