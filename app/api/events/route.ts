import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import {
  assertEventOwnership,
  assertEventStatus,
  requireAuth,
  requireRole,
} from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { eventSchema } from "@/globals/schemas";
import { toDate } from "@/globals/utils/events";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";
import { validateEventGroupIds } from "@/globals/utils/eventGroups";
import {
  AUDIENCE_CHANGE_HAS_RECORDS_CODE,
  getEventAudienceChangeError,
} from "@/globals/utils/eventAudienceGuard";

const eventStatusEnum = z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED"]);
const eventScopeEnum = z.enum(["visible", "mine"]);

const listQuerySchema = z.object({
  status: eventStatusEnum.optional(),
  scope: eventScopeEnum.optional(),
});

const deleteSchema = z.object({ id: z.string().min(1) });

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const query = listQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );

    // Reject invalid status/scope instead of silently returning an unfiltered
    // (broader) result than the caller asked for.
    if (!query.success) {
      return NextResponse.json(err("Invalid status or scope parameter."), {
        status: 400,
      });
    }

    const where: Record<string, unknown> = {};
    const statusFilter = query.data.status;
    const scopeFilter = query.data.scope;

    if (user.role === "ADMIN") {
      if (statusFilter) {
        where.status = statusFilter;
      }
    } else {
      const resolvedScope = scopeFilter ?? "visible";

      if (resolvedScope === "mine") {
        where.createdById = user.id;

        if (statusFilter) {
          where.status = statusFilter;
        }
      } else if (!statusFilter) {
        where.OR = [{ createdById: user.id }, { status: "APPROVED" }];
      } else if (statusFilter === "APPROVED") {
        where.status = "APPROVED";
      } else {
        where.createdById = user.id;
        where.status = statusFilter;
      }
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        includedGroups: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { start: "asc" },
    });

    // Expose organizerName so list-driven UI (dashboard, reports summary)
    // needn't show a raw user id.
    const withOrganizer = events.map(({ createdBy, ...event }) => ({
      ...event,
      organizerName: createdBy?.name ?? null,
    }));

    return NextResponse.json(ok(withOrganizer), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const rawData = await req.json();

    const payload = eventSchema.parse({
      ...rawData,
      start: toDate(rawData.start),
      end: toDate(rawData.end),
    });

    // Reject group ids that don't exist or don't match the event category,
    // so a crafted request can't scope an event to another category's groups.
    const groupError = await validateEventGroupIds(
      payload.category,
      payload.includedGroups,
    );
    if (groupError) {
      return NextResponse.json(err(groupError), { status: 400 });
    }

    const baseData = {
      title: payload.title,
      location: payload.location,
      category: payload.category,
      includedGroups: payload.includedGroups,
      description: payload.description,
      start: payload.start,
      end: payload.end,
      allDay: payload.allDay,
    };

    if (payload.id) {
      const eventId = payload.id;
      const existing = await prisma.event.findUnique({
        where: { id: eventId },
        include: { includedGroups: true },
      });

      if (!existing) {
        return NextResponse.json(ok(null), { status: 404 });
      }

      assertEventOwnership(existing, user);

      // Non-admins can only edit drafts and rejected events. Approved events
      // are locked so content cannot change without re-review.
      const editableStatuses: Array<
        "DRAFT" | "PENDING" | "APPROVED" | "REJECTED"
      > =
        user.role === "ADMIN"
          ? ["DRAFT", "PENDING", "APPROVED", "REJECTED"]
          : ["DRAFT", "REJECTED"];
      assertEventStatus(existing, editableStatuses);

      // Rescoping an approved event that already has attendance rewrites its
      // report retroactively, so require an explicit acknowledgement first
      // (mirrors the delete path's EVENT_HAS_RECORDS guard).
      const audienceError = await getEventAudienceChangeError(existing, payload);
      if (audienceError) {
        return NextResponse.json(
          err(audienceError, AUDIENCE_CHANGE_HAS_RECORDS_CODE),
          { status: 409 },
        );
      }

      // Editing a rejected event returns it to DRAFT (clearing the review) so
      // the organizer can fix it and resubmit.
      const rejectionReset =
        user.role !== "ADMIN" && existing.status === "REJECTED"
          ? {
              status: "DRAFT" as const,
              reviewedById: null,
              reviewedAt: null,
              rejectionReason: null,
            }
          : {};

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
        assertEventStatus(fresh, editableStatuses);
        return tx.event.update({
          where: { id: eventId },
          data: {
            ...baseData,
            ...rejectionReset,
            includedGroups: {
              set: baseData.includedGroups.map((g) => ({ id: g })),
            },
          },
        });
      });

      if (!updated) {
        return NextResponse.json(ok(null), { status: 404 });
      }

      return NextResponse.json(ok(updated), { status: 200 });
    }

    requireRole(user, ["ORGANIZER", "ADMIN"]);

    // Creation affects eligibility: exclusive roster freeze for the insert.
    const created = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      return tx.event.create({
        data: {
          ...baseData,
          status: "DRAFT",
          createdById: user.id,
          includedGroups: {
            connect: baseData.includedGroups.map((g) => ({ id: g })),
          },
        },
        include: { includedGroups: true },
      });
    });

    return NextResponse.json(ok(created), { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireAuth();
    const { id } = deleteSchema.parse(await req.json());

    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(ok(null), { status: 404 });
    }

    assertEventOwnership(existing, user);

    // Lifecycle write: exclusive roster freeze + FOR UPDATE, with
    // ownership rechecked and the attendance count taken inside the lock.
    const outcome = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id} FOR UPDATE`;
      const fresh = await tx.event.findUnique({ where: { id } });
      if (!fresh) return "missing" as const;
      assertEventOwnership(fresh, user);

      const attendanceCount = await tx.record.count({
        where: { eventId: fresh.id },
      });

      if (attendanceCount > 0) return "blocked" as const;

      await tx.event.delete({ where: { id } });
      return "deleted" as const;
    });

    if (outcome === "missing") {
      return NextResponse.json(ok(null), { status: 404 });
    }

    if (outcome === "blocked") {
      return NextResponse.json(
        err(
          "Cannot delete this event because attendance has already been recorded.",
          "EVENT_HAS_RECORDS",
        ),
        { status: 409 },
      );
    }

    return NextResponse.json(ok(null), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
