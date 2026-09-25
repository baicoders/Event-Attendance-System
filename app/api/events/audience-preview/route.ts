import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { audiencePreviewSchema } from "@/globals/schemas/audiencePreview";
import { err, ok } from "@/globals/utils/api";
import { assertEventOwnership, assertEventStatus, requireAuth } from "@/globals/utils/auth";
import { AudienceScopeError, previewAudience } from "@/globals/utils/audiencePreview";
import { validateEventGroupIds } from "@/globals/utils/eventGroups";
import { respondWithError } from "@/globals/utils/httpError";

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const input = audiencePreviewSchema.parse(await req.json());

    if (input.eventId) {
      const event = await prisma.event.findUnique({ where: { id: input.eventId } });
      if (!event) return NextResponse.json(err("Event not found."), { status: 404 });
      assertEventOwnership(event, user);
      assertEventStatus(event, user.role === "ADMIN"
        ? ["DRAFT", "PENDING", "APPROVED", "REJECTED"]
        : ["DRAFT", "REJECTED"]);
    }

    const groupError = await validateEventGroupIds(input.category, input.includedGroups);
    if (groupError) return NextResponse.json(err(groupError, "INVALID_GROUPS"), { status: 400 });

    return NextResponse.json(ok(await previewAudience(input)));
  } catch (error) {
    if (error instanceof AudienceScopeError) {
      return NextResponse.json(err(error.message, "INVALID_GROUPS"), { status: 400 });
    }
    return respondWithError(error);
  }
}
