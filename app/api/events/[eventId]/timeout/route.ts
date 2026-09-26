import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import {
  assertEventOwnership,
  assertEventStatus,
  requireAuth,
} from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { takeRosterSharedLock } from "@/globals/utils/pgLocks";
import { NextResponse } from "next/server";
import { z } from "zod";

// Explicit desired state instead of a blind toggle: two concurrent requests
// that both intend "time-out" now converge on the same value instead of
// cancelling each other out. `isTimeout` is optional for backward compat -
// omitting it falls back to a single compare-and-set toggle.
const bodySchema = z.object({ isTimeout: z.boolean().optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const raw = await req.json().catch(() => ({}));
    const { isTimeout } = bodySchema.parse(raw);

    const updated = await prisma.$transaction(async (tx) => {
      // Event mutation: shared roster freeze + FOR UPDATE on the Event row,
      // then re-read ownership/status/mode after locking so scans linearize.
      await takeRosterSharedLock(tx);
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.event.findUnique({ where: { id: eventId } });
      if (!existing) return null;
      assertEventOwnership(existing, user);
      assertEventStatus(existing, "APPROVED");
      const desired = isTimeout ?? !existing.isTimeout;
      // Compare-and-set: only flip when still in the state we based `desired` on,
      // so simultaneous requests can't stomp each other.
      await tx.event.updateMany({
        where: { id: eventId, isTimeout: !desired },
        data: { isTimeout: desired },
      });
      return tx.event.findUnique({ where: { id: eventId } });
    });

    if (!updated) {
      return NextResponse.json(err("No event found"), { status: 404 });
    }
    return NextResponse.json(ok(updated), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
