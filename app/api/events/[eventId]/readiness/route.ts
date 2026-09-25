import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth, assertEventVisibility } from "@/globals/utils/auth";
import { AudienceScopeError, resolveAudienceScope } from "@/globals/utils/audiencePreview";
import { evaluateEventReadiness } from "@/globals/utils/eventReadiness";
import { respondWithError } from "@/globals/utils/httpError";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const viewer = await requireAuth();
    const { eventId } = await params;
    z.string().min(1).max(100).parse(eventId);

    // SQLite transactions provide a consistent read snapshot. Keep group
    // validation and the count inside it, with no roster or ledger download.
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          id: true, updatedAt: true, status: true, category: true,
          start: true, end: true, allDay: true, isTimeout: true,
          createdById: true,
          createdBy: { select: { name: true, status: true } },
          includedGroups: { select: { id: true } },
        },
      });
      if (!event) return null;
      assertEventVisibility(event, viewer);

      let eligibleCount: number | null = null;
      let invalidAudience = false;
      try {
        const where = await resolveAudienceScope(tx, {
          category: event.category,
          includedGroups: event.includedGroups.map((group) => group.id),
        });
        eligibleCount = await tx.student.count({ where });
      } catch (error) {
        if (!(error instanceof AudienceScopeError)) throw error;
        invalidAudience = true;
      }

      return evaluateEventReadiness({
        ...event, owner: event.createdBy, viewer,
        eligibleCount, invalidAudience,
      });
    }, { maxWait: 2_000, timeout: 5_000 });

    return result
      ? NextResponse.json(ok(result), { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json(err("Event not found."), { status: 404 });
  } catch (error) {
    return respondWithError(error);
  }
}
