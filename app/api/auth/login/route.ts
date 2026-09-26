import { NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { setAuthSession } from "@/globals/utils/auth";
import {
  hashPassword,
  isHashedPassword,
  verifyPassword,
} from "@/globals/utils/password";
import { applyLegacyPasswordUpgrade } from "@/globals/utils/credentials";
import { loginSchema } from "@/features/auth/schema/loginSchema";
import { clientKey, rateLimit } from "@/globals/utils/rateLimit";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  try {
    const parsed = loginSchema.parse(await req.json());
    const email = parsed.email.trim().toLowerCase();
    const password = parsed.password;

    // 10 attempts per client+account per 5 minutes
    if (!rateLimit(`login:${clientKey(req)}:${email}`, 10, 5 * 60_000)) {
      return NextResponse.json(
        err("Too many login attempts. Try again in a few minutes."),
        { status: 429, headers: NO_STORE },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(password, user.password))) {
      return NextResponse.json(err("Invalid credentials."), {
        status: 401,
        headers: NO_STORE,
      });
    }

    // Transparently upgrade legacy plaintext rows, without overwriting a
    // credential that won a concurrent reset. The conditional write only
    // replaces the exact stored value that was just verified.
    let current = user;
    if (!isHashedPassword(user.password)) {
      const upgradedHash = await hashPassword(password);
      await applyLegacyPasswordUpgrade(prisma, {
        userId: user.id,
        verifiedStoredValue: user.password,
        newPasswordHash: upgradedHash,
      });
      // Re-read: a reset/change that won the race changes the stored value,
      // so old verification must not mint a new-generation session.
      const reread = await prisma.user.findUnique({ where: { email } });
      if (
        !reread ||
        !(await verifyPassword(password, reread.password))
      ) {
        return NextResponse.json(err("Invalid credentials."), {
          status: 401,
          headers: NO_STORE,
        });
      }
      current = reread;
    } else {
      // Even for hashed rows, a reset during verification must invalidate
      // this attempt: the stored value must still be the verified one.
      const reread = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          role: true,
          status: true,
          rejectionReason: true,
          mustChangePassword: true,
          credentialVersion: true,
        },
      });
      if (!reread || reread.password !== user.password) {
        return NextResponse.json(err("Invalid credentials."), {
          status: 401,
          headers: NO_STORE,
        });
      }
      current = { ...user, ...reread };
    }

    if (current.status === "PENDING") {
      return NextResponse.json(err("Account pending admin approval."), {
        status: 403,
        headers: NO_STORE,
      });
    }

    if (current.status === "REJECTED") {
      return NextResponse.json(
        err(
          current.rejectionReason ??
            "Your registration was rejected. Please contact an administrator.",
        ),
        { status: 403, headers: NO_STORE },
      );
    }

    // A restricted (mustChangePassword) session is issued here deliberately:
    // it can only read its session identity, replace its own password, or
    // sign out until replacement. Every other route's `requireAuth()` rejects
    // it server-side.
    const session = {
      id: current.id,
      name: current.name,
      email: current.email,
      role: current.role,
      status: current.status,
      rejectionReason: current.rejectionReason,
      mustChangePassword: current.mustChangePassword,
      credentialVersion: current.credentialVersion,
    };

    await setAuthSession(session);

    return NextResponse.json(ok(session), {
      status: 200,
      headers: NO_STORE,
    });
  } catch (error) {
    return respondWithError(error);
  }
}
