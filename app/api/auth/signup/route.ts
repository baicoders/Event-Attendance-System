import { randomUUID } from "node:crypto";
import { setAuthSession } from "@/globals/utils/auth";
import { PUBLIC_IDENTITY_SELECT } from "@/features/classroom/server/access";
import { readLimitedJson } from "@/globals/utils/requestBody";
import { NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { hashPassword } from "@/globals/utils/password";
import { clientKey, rateLimit } from "@/globals/utils/rateLimit";
import { signupSchema } from "@/features/auth/schema/signupSchema";

export async function POST(req: Request) {
  try {
    const parsed = signupSchema.parse(await readLimitedJson(req));
    const name = parsed.name;
    // Normalized so case-variant duplicate accounts are impossible
    const email = parsed.email.trim().toLowerCase();
    const password = parsed.password;

    // No reverse proxy in front of this deployment, so clientKey() cannot
    // distinguish devices on the LAN and this bucket is effectively shared
    // by everyone. Sized to comfortably cover onboarding a whole staff in
    // one sitting rather than one person's realistic signup rate.
    if (!await rateLimit(`signup:${clientKey(req)}`, 20, 10 * 60_000)) {
      return NextResponse.json(
        err("Too many signup attempts. Try again in a few minutes."),
        { status: 429 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return NextResponse.json(err("Email is already registered."), {
        status: 409,
      });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: { name, email, password: hashedPassword, role: parsed.workspace === "CLASS" ? "MEMBER" : "ORGANIZER", status: "PENDING" },
        select: PUBLIC_IDENTITY_SELECT,
      });
      if (parsed.workspace === "CLASS") {
        const member = await tx.classroomMembership.create({ data: {
          userId: created.id, departmentOrDesignation: parsed.departmentOrDesignation!,
          staffReference: parsed.staffReference || null, applicationText: parsed.applicationText ?? "",
        } });
        await tx.classroomAudit.create({ data: {
          action: "TEACHER_APPLICATION_SUBMITTED", entityType: "ClassroomMembership", entityId: created.id,
          actorId: created.id, actorName: created.name, commandId: randomUUID(), after: JSON.parse(JSON.stringify(member)),
        } });
      }
      return created;
    });
    if (parsed.workspace === "CLASS") await setAuthSession(user);

    return NextResponse.json(
      ok({
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
      }),
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return respondWithError(error);
  }
}
