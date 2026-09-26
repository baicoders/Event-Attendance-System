import type {
  AttendanceMethod,
  EventCategory,
  Group,
  Event as PrismaEvent,
  SchoolLevel,
  YearLevel,
} from "@prisma/client";

import type { AttendanceOutcome } from "@/globals/utils/attendance";
import type { GroupDimension, GroupSummary } from "@/globals/utils/reportGroups";

/**
 * Report payload shapes, shared by the server builders and the client hooks.
 *
 * These live here rather than beside the builders because
 * `globals/utils/eventReport.ts` and `reportsOverview.ts` are `server-only`;
 * importing types across that boundary works today only because `import type` is
 * erased, which is a trap waiting for the first stray value import.
 *
 * Follows the app's existing wire-format convention (`Event` vs `EventAPI` in
 * `globals/types/events.ts`): the plain name carries real `Date`s, the `API`
 * suffix carries the ISO strings that actually cross the network.
 *
 * @see globals/utils/eventReport.ts
 * @see docs/plans/reports-overhaul.md
 */

/**
 * The event shape a report carries.
 *
 * `createdBy` is narrowed to id + name on purpose — this object is serialized to
 * the client, and a bare `include: { createdBy: true }` would ship the
 * organizer's password hash.
 */
export type ReportEvent = PrismaEvent & {
  includedGroups: Group[];
  createdBy: { id: string; name: string } | null;
};

export type ReportEventAPI = Omit<
  ReportEvent,
  "start" | "end" | "createdAt" | "updatedAt" | "reviewedAt"
> & {
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

/** One eligible student's line in the report. Identical on both sides. */
export type ReportRow = {
  recordId: string | null;
  studentId: string;
  fullName: string;
  schoolLevel: SchoolLevel;
  yearLevel: YearLevel;
  /** `SECTION` group name, or null when the student has none. */
  section: string | null;
  sectionKey: string;
  timein: string | null;
  timeout: string | null;
  /** Null for absent students — no record means no method. */
  method: AttendanceMethod | null;
  outcome: AttendanceOutcome;
  noTimeout: boolean;
  reviewFlags: string[];
};

export type ReportTotals = {
  eligible: number;
  /** On time only. Late arrivals are counted separately. */
  present: number;
  late: number;
  absent: number;
  /**
   * Everyone who turned up, late included. **This is the numerator of the rate**
   * and is what `GET /api/events/[eventId]/stats` calls `present`.
   */
  attended: number;
  noTimeout: number;
  scanned: number;
  manual: number;
};

export type SectionBreakdown = {
  key: string;
  name: string;
  eligible: number;
  present: number;
  late: number;
  absent: number;
};

export type ArrivalBucket = {
  /** ISO timestamp of the bucket's start. */
  bucketStart: string;
  count: number;
};

export type EventReport = {
  evaluatedAt: string;
  timeZone: "Asia/Manila";
  populationBasis: "CURRENT_ROSTER";
  event: ReportEvent;
  /** Whether this event actually collected time-outs. */
  expectsTimeout: boolean;
  totals: ReportTotals;
  /** Percentage, or null when nobody is eligible. */
  rate: number | null;
  arrivals: ArrivalBucket[];
  bySection: SectionBreakdown[];
  byGroup: Record<GroupDimension, GroupSummary[]>;
  rows: ReportRow[];
};

export type EventReportAPI = Omit<EventReport, "event"> & {
  event: ReportEventAPI;
};

// ---------------------------------------------------------------------------
// Cross-event overview
//
// Every field is already a primitive or an ISO string, so the wire shape and the
// client shape are the same — no `API` variant is needed.
// ---------------------------------------------------------------------------

export type OverviewEvent = {
  id: string;
  title: string;
  /** ISO timestamp. */
  start: string;
  category: EventCategory;
  eligible: number;
  /** Everyone who turned up, late included. */
  present: number;
  /** Percentage, or null when nobody was eligible. */
  rate: number | null;
};

export type CategorySummary = {
  category: EventCategory;
  events: number;
  /** Mean of this category's per-event rates, or null if none are rateable. */
  averageRate: number | null;
};

export type OverviewTotals = {
  events: number;
  presentSum: number;
  eligibleSum: number;
  /**
   * Mean of the per-event rates — each **event** weighted equally, which is what
   * "average turnout" means to a reader comparing events.
   *
   * Deliberately not `presentSum / eligibleSum`; that weights each *student*
   * equally and lets one school-wide event drown out a week of small ones. Both
   * sums are exposed so the other figure can be shown alongside if wanted.
   */
  averageRate: number | null;
};

export type ReportsOverview = {
  range: { from: string; to: string };
  totals: OverviewTotals;
  best: OverviewEvent | null;
  worst: OverviewEvent | null;
  events: OverviewEvent[];
  byCategory: CategorySummary[];
};
