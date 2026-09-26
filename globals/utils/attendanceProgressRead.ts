import { PrismaClient, type EventCategory } from "@prisma/client";
import { buildEventStudentFilter } from "./buildEventStudentFilter";
import { buildAttendanceProgress, type ProgressGroup } from "./attendanceProgress";
import type { ProgressQuery } from "./attendanceProgressQuery";

export class ProgressReadError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

/** Load authorization, targeting, and the eligible population in one SQLite read transaction. */
export async function readAttendanceProgress(
  db: PrismaClient,
  eventId: string,
  viewer: { id: string },
  query: ProgressQuery,
  probe?: { afterEventRead?: () => Promise<void> },
) {
  const snapshot = await db.$transaction(async (tx) => {
    const currentViewer = await tx.user.findUnique({ where: { id: viewer.id }, select: { role: true, status: true } });
    if (!currentViewer) throw new ProgressReadError("Unauthorized", 401, "UNAUTHORIZED");
    if (currentViewer.status !== "ACTIVE") throw new ProgressReadError("Account not active", 403, "INACTIVE_USER");
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true, title: true, status: true, isTimeout: true, category: true, createdById: true,
        includedGroups: { select: { id: true, slug: true } },
      },
    });
    if (!event) throw new ProgressReadError("Event not found.", 404, "EVENT_NOT_FOUND");
    if (currentViewer.role !== "ADMIN" && event.createdById !== viewer.id && event.status !== "APPROVED") {
      throw new ProgressReadError("Forbidden", 403, "FORBIDDEN");
    }
    if (event.status !== "APPROVED") throw new ProgressReadError("Live progress is available for approved events only.", 409, "INVALID_STATUS");
    await probe?.afterEventRead?.();

    let selectedGroup: ProgressGroup | null = null;
    if (query.bucket.startsWith("g:")) {
      const group = await tx.group.findUnique({
        where: { id: query.bucket.slice(2) },
        select: { id: true, name: true, slug: true, category: true },
      });
      if (!group || group.category !== query.groupBy) {
        throw new ProgressReadError("This group is no longer valid for the selected breakdown.", 400, "INVALID_PROGRESS_BUCKET");
      }
      selectedGroup = group;
    }

    // The selected dimension and section label are the only memberships the
    // response needs; avoid loading every academic relation on every poll.
    const groupCategories: EventCategory[] = query.groupBy === "YEAR" || query.groupBy === "SECTION"
      ? ["SECTION"] : ["SECTION", query.groupBy];
    const students = await tx.student.findMany({
      where: buildEventStudentFilter(event),
      select: {
        id: true, firstName: true, middleName: true, lastName: true, schoolLevel: true, yearLevel: true,
        groups: { where: { category: { in: groupCategories } }, select: { id: true, name: true, slug: true, category: true } },
        records: { where: { eventId }, select: { timein: true, timeout: true } },
      },
    });
    return { event, students, selectedGroup, evaluatedAt: new Date().toISOString() };
  }, { maxWait: 5_000, timeout: 15_000 });

  const { event, students, selectedGroup, evaluatedAt } = snapshot;
  return {
    event: { id: event.id, title: event.title, status: event.status, isTimeout: event.isTimeout },
    evaluatedAt,
    audienceSignature: JSON.stringify([event.category, event.includedGroups.map((group) => [group.id, group.slug]).sort()]),
    populationBasis: "CURRENT_ROSTER" as const,
    groupBy: query.groupBy,
    ...buildAttendanceProgress({ students, query, selectedGroup }),
  };
}

export type AttendanceProgressResponse = Awaited<ReturnType<typeof readAttendanceProgress>>;
