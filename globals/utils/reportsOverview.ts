import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/globals/libs/prisma";
import type { Event } from "@/globals/types/events";
import type {
  OverviewEvent,
  ReportsOverview,
} from "@/globals/types/reports";
import { attendanceRate } from "@/globals/utils/attendance";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";

/**
 * Cross-event attendance aggregation for the reports hub.
 *
 * ## Why this only covers APPROVED events
 *
 * Attendance is only writable on APPROVED events (`domain-model.md` rule 3), so a
 * DRAFT or PENDING event has no records by construction. Including one would
 * report it as 0% turnout for an event that never ran and drag every average down.
 *
 * This also makes authorization trivially safe: an approved event is readable by
 * every active user (`assertEventVisibility` — "approval makes an event shared"),
 * so restricting to APPROVED is *strictly narrower* than what any caller may see.
 * There is no way for this to leak another organizer's draft.
 *
 * @see docs/plans/reports-overhaul.md
 */

type BuildOverviewArgs = {
  from: Date;
  to: Date;
  category?: Event["category"];
};

/**
 * A stable key for "these events share an eligibility filter".
 *
 * Level-scoped categories ignore `includedGroups` entirely, so every `ALL` event
 * in the range resolves to one identical query. Group-scoped categories are keyed
 * on their sorted slugs. Events that share a key share both their eligible count
 * and one batched record query, which is what keeps this from being 2N round trips.
 */
function eligibilityKey(event: Event): string {
  if (
    event.category === "ALL" ||
    event.category === "COLLEGE" ||
    event.category === "SHS"
  ) {
    return `level:${event.category}`;
  }
  return `groups:${event.includedGroups
    .map((group) => group.slug)
    .sort()
    .join(",")}`;
}

const mean = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export async function buildOverview({
  from,
  to,
  category,
}: BuildOverviewArgs): Promise<ReportsOverview> {
  const where: Prisma.EventWhereInput = {
    status: "APPROVED",
    start: { gte: from, lte: to },
    ...(category ? { category } : {}),
  };

  const events = await prisma.event.findMany({
    where,
    include: { includedGroups: true },
    orderBy: { start: "desc" },
  });

  // Bucket by eligibility filter so events sharing a scope share their queries.
  const buckets = new Map<string, Event[]>();
  for (const event of events) {
    const key = eligibilityKey(event);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }

  const eligibleByEvent = new Map<string, number>();
  const presentByEvent = new Map<string, number>();

  await Promise.all(
    [...buckets.values()].map(async (bucketEvents) => {
      // Every event in the bucket resolves to the same filter, so build it once.
      const filter = buildEventStudentFilter(bucketEvents[0]);
      const eventIds = bucketEvents.map((event) => event.id);

      // Records are counted among *currently eligible* students only, matching
      // every other read path — otherwise an orphaned record (a student who left
      // the event's scope) could push turnout above 100%.
      const [eligible, grouped] = await Promise.all([
        prisma.student.count({ where: filter }),
        prisma.record.groupBy({
          by: ["eventId"],
          where: { eventId: { in: eventIds }, timein: { not: null }, student: filter },
          _count: { _all: true },
        }),
      ]);

      for (const id of eventIds) {
        eligibleByEvent.set(id, eligible);
        presentByEvent.set(id, 0);
      }
      for (const row of grouped) {
        presentByEvent.set(row.eventId, row._count._all);
      }
    }),
  );

  const overviewEvents: OverviewEvent[] = events.map((event) => {
    const eligible = eligibleByEvent.get(event.id) ?? 0;
    const present = presentByEvent.get(event.id) ?? 0;

    return {
      id: event.id,
      title: event.title,
      start: event.start.toISOString(),
      category: event.category,
      eligible,
      present,
      rate: attendanceRate(present, eligible),
    };
  });

  // An event nobody was eligible for has no rate, so it can neither be the best
  // nor the worst and must not skew the average.
  const rateable = overviewEvents.filter(
    (event): event is OverviewEvent & { rate: number } => event.rate !== null,
  );
  const ranked = [...rateable].sort((a, b) => b.rate - a.rate);

  const byCategory = [...new Set(events.map((event) => event.category))]
    .map((eventCategory) => {
      const inCategory = overviewEvents.filter(
        (event) => event.category === eventCategory,
      );
      return {
        category: eventCategory,
        events: inCategory.length,
        averageRate: mean(
          inCategory
            .filter((event) => event.rate !== null)
            .map((event) => event.rate as number),
        ),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      events: overviewEvents.length,
      presentSum: overviewEvents.reduce((sum, e) => sum + e.present, 0),
      eligibleSum: overviewEvents.reduce((sum, e) => sum + e.eligible, 0),
      averageRate: mean(rateable.map((event) => event.rate)),
    },
    best: ranked[0] ?? null,
    worst: ranked.length > 0 ? ranked[ranked.length - 1] : null,
    events: overviewEvents,
    byCategory,
  };
}
