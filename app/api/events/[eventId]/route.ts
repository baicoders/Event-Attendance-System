import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import {
  assertEventOwnership,
  assertEventStatus,
  assertEventVisibility,
  requireAuth,
  requireRole,
} from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { validateEventGroupIds } from "@/globals/utils/eventGroups";
import {
  AUDIENCE_CHANGE_HAS_RECORDS_CODE,
  getEventAudienceChangeError,
} from "@/globals/utils/eventAudienceGuard";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";

const submitSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT"]),
});
const rejectionSchema = z.object({ reason: z.string().min(1) });

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    location: z.string().max(200).nullable().optional(),
    category: z.enum([
      "ALL",
      "COLLEGE",
      "SHS",
      "DEPARTMENT",
      "HOUSE",
      "STRAND",
      "PROGRAM",
      "SECTION",
      "YEAR",
    ]),
    includedGroups: z.array(z.string()).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    allDay: z.boolean().optional().default(false),
    // See eventSchema: set by the client only after confirming the consequence
    // of rescoping an approved event that already has attendance. Kept in sync
    // with globals/schemas/index.ts's eventSchema by hand (do not merge).
    acknowledgeAudienceChange: z.boolean().optional(),
  })
  .refine((data) => data.end.getTime() >= data.start.getTime(), {
    message: "End must be the same or after start.",
    path: ["end"],
  });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        includedGroups: true,
        createdBy: { select: { name: true } },
      },
    });

    if (!event) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    assertEventVisibility(event, user);

    // Expose the organizer's display name so the UI needn't show a raw user id.
    const { createdBy, ...rest } = event;
    return NextResponse.json(
      ok({ ...rest, organizerName: createdBy?.name ?? null }),
      { status: 200 }
    );
  } catch (error) {
    return respondWithError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;
    const payload = await req.json();

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { includedGroups: true },
    });

    if (!event) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    const actionParse = submitSchema.safeParse(payload);
    if (actionParse.success) {
      const action = actionParse.data.action;

      if (action === "SUBMIT") {
        assertEventOwnership(event, user);
        assertEventStatus(event, "DRAFT");

        const updated = await prisma.$transaction(async (tx) => {
          await takeRosterExclusiveLock(tx);
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
          const fresh = await tx.event.findUnique({ where: { id: eventId } });
          if (!fresh) return null;
          assertEventOwnership(fresh, user);
          assertEventStatus(fresh, "DRAFT");
          return tx.event.update({
            where: { id: eventId },
            data: {
              status: "PENDING",
              reviewedById: null,
              rejectionReason: null,
              reviewedAt: null,
            },
          });
        });
        if (!updated) {
          return NextResponse.json(err("Event not found."), { status: 404 });
        }

        return NextResponse.json(ok(updated), { status: 200 });
      }

      requireRole(user, "ADMIN");

      if (action === "APPROVE") {
        // DRAFT is intentionally not approvable: drafts must be submitted
        // first so the approval always reviews a finished event.
        assertEventStatus(event, ["PENDING", "REJECTED", "APPROVED"]);
        const approved = await prisma.$transaction(async (tx) => {
          await takeRosterExclusiveLock(tx);
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
          const fresh = await tx.event.findUnique({ where: { id: eventId } });
          if (!fresh) return null;
          assertEventStatus(fresh, ["PENDING", "REJECTED", "APPROVED"]);
          return tx.event.update({
            where: { id: eventId },
            data: {
              status: "APPROVED",
              reviewedById: user.id,
              reviewedAt: new Date(),
              rejectionReason: null,
            },
          });
        });
        if (!approved) {
          return NextResponse.json(err("Event not found."), { status: 404 });
        }

        return NextResponse.json(ok(approved), { status: 200 });
      }

      if (action === "REJECT") {
        assertEventStatus(event, "PENDING");
        const { reason } = rejectionSchema.parse(payload);

        const rejected = await prisma.$transaction(async (tx) => {
          await takeRosterExclusiveLock(tx);
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
          const fresh = await tx.event.findUnique({ where: { id: eventId } });
          if (!fresh) return null;
          assertEventStatus(fresh, "PENDING");
          return tx.event.update({
            where: { id: eventId },
            data: {
              status: "REJECTED",
              reviewedById: user.id,
              reviewedAt: new Date(),
              rejectionReason: reason,
            },
          });
        });
        if (!rejected) {
          return NextResponse.json(err("Event not found."), { status: 404 });
        }

        return NextResponse.json(ok(rejected), { status: 200 });
      }
    }

    // Default PATCH behavior: editing event content.
    // Non-admins can only edit drafts and rejected events; approved events
    // are locked so content cannot change without re-review.
    const data = patchSchema.parse(payload);

    // Reject group ids that don't exist or don't match the event category.
    const groupError = await validateEventGroupIds(
      data.category,
      data.includedGroups,
    );
    if (groupError) {
      return NextResponse.json(err(groupError), { status: 400 });
    }

    assertEventOwnership(event, user);
    assertEventStatus(
      event,
      user.role === "ADMIN"
        ? ["DRAFT", "PENDING", "APPROVED", "REJECTED"]
        : ["DRAFT", "REJECTED"]
    );

    // Rescoping an approved event that already has attendance rewrites its
    // report retroactively, so require an explicit acknowledgement first
    // (mirrors the delete path's EVENT_HAS_RECORDS guard).
    const audienceError = await getEventAudienceChangeError(event, {
      category: data.category,
      includedGroups: data.includedGroups,
      acknowledgeAudienceChange: data.acknowledgeAudienceChange,
    });
    if (audienceError) {
      return NextResponse.json(
        err(audienceError, AUDIENCE_CHANGE_HAS_RECORDS_CODE),
        { status: 409 }
      );
    }

    // Editing a rejected event returns it to DRAFT (clearing the review)
    // so the organizer can fix it and resubmit.
    const rejectionReset =
      user.role !== "ADMIN" && event.status === "REJECTED"
        ? {
            status: "DRAFT" as const,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
          }
        : {};

    const { includedGroups, ...eventData } = data;
    // acknowledgeAudienceChange is a client-only signal, not a Prisma column.
    delete eventData.acknowledgeAudienceChange;
    // Content mutation (may rescope eligibility): exclusive roster freeze +
    // FOR UPDATE, with ownership/status rechecked after locking.
    const updated = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
      const fresh = await tx.event.findUnique({
        where: { id: eventId },
        include: { includedGroups: true },
      });
      if (!fresh) return null;
      assertEventOwnership(fresh, user);
      assertEventStatus(
        fresh,
        user.role === "ADMIN"
          ? ["DRAFT", "PENDING", "APPROVED", "REJECTED"]
          : ["DRAFT", "REJECTED"]
      );
      return tx.event.update({
        where: { id: eventId },
        data: {
          ...eventData,
          ...rejectionReset,
          ...(includedGroups
            ? { includedGroups: { set: includedGroups.map((id) => ({ id })) } }
            : {}),
        },
      });
    });
    if (!updated) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    return NextResponse.json(ok(updated), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const existing = await prisma.event.findUnique({ where: { id: eventId } });
    if (!existing) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    assertEventOwnership(existing, user);

    const blocked = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
      const fresh = await tx.event.findUnique({ where: { id: eventId } });
      if (!fresh) return "missing" as const;
      assertEventOwnership(fresh, user);
      const attendanceCount = await tx.record.count({ where: { eventId: fresh.id } });
      if (attendanceCount > 0 || await tx.attendanceChange.count({ where: { eventId: fresh.id } })) return "blocked" as const;
      await tx.event.delete({ where: { id: eventId } });
      return "deleted" as const;
    });

    if (blocked === "missing") {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    if (blocked === "blocked") {
      return NextResponse.json(
        err(
          "Cannot delete this event because attendance has already been recorded.",
          "EVENT_HAS_RECORDS"
        ),
        { status: 409 }
      );
    }

    return NextResponse.json(ok(null), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
