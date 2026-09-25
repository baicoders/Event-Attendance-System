import { LATE_GRACE_MINUTES } from "@/globals/constants/attendance";

/**
 * Derived attendance status.
 *
 * Nothing here is stored. `Record` has no status column and gains none — this is
 * computed from `Record.timein`, `Record.timeout`, and `Event.start`. Kept free of `server-only`
 * so the API routes, the print server component, and the client table all reach
 * the same verdict from the same code.
 *
 * @see globals/constants/attendance.ts — the grace period and colours
 * @see docs/plans/reports-overhaul.md
 */
export type AttendanceOutcome = "PRESENT" | "LATE" | "ABSENT";

/**
 * Human labels for an outcome. Shared by the on-screen table and the printed
 * attendance sheet so the paper and the screen never word the same fact
 * differently.
 */
export const ATTENDANCE_OUTCOME_LABEL: Record<AttendanceOutcome, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
};

/** The only parts of an event that judging lateness depends on. */
export type OutcomeEvent = {
  start: Date | string;
  allDay: boolean;
};

/** The only parts of a record that judging attendance depends on. */
export type OutcomeRecord = {
  timein: Date | string | null;
  timeout?: Date | string | null;
};

/** Wire payloads carry ISO strings; Prisma carries `Date`. Accept both. */
const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

/**
 * Present, late, or absent for one eligible student.
 *
 * - **ABSENT** — no record, or a record with neither timestamp.
 * - **LATE** — timed in more than {@link LATE_GRACE_MINUTES} after `event.start`.
 * - **PRESENT** — timed in within the grace period, any time before `start`, or
 *   timed out without a recorded time-in. A missing arrival cannot be judged late.
 *
 * **All-day events are never late.** Their `start` is normalized to midnight, so
 * comparing against it would flag every single attendee. For those, the outcome is
 * only PRESENT or ABSENT.
 */
export function deriveOutcome(
  record: OutcomeRecord | null | undefined,
  event: OutcomeEvent,
): AttendanceOutcome {
  if (!record?.timein) return record?.timeout ? "PRESENT" : "ABSENT";
  if (event.allDay) return "PRESENT";

  const cutoff = toDate(event.start).getTime() + LATE_GRACE_MINUTES * 60_000;

  return toDate(record.timein).getTime() > cutoff ? "LATE" : "PRESENT";
}

/**
 * Whether this event actually collected time-outs.
 *
 * `Event.isTimeout` is a **live mode toggle** — "scans currently record time-out" —
 * not a declaration that time-out is required. An ordinary time-in-only event
 * leaves it `false` and has no time-outs at all, so flagging its attendees for a
 * missing time-out would mark 100% of them. Treat time-out as expected only when
 * the event is in that mode, or when at least one time-out was genuinely recorded.
 */
export function expectsTimeout(
  event: { isTimeout: boolean },
  records: ReadonlyArray<{ timeout: Date | string | null }>,
): boolean {
  return event.isTimeout || records.some((record) => !!record.timeout);
}

/**
 * Whether a student timed in but never timed out.
 *
 * Always `false` when the event didn't collect time-outs — see
 * {@link expectsTimeout} for why that guard matters.
 */
export function hasNoTimeout(
  record: OutcomeRecord | null | undefined,
  eventExpectsTimeout: boolean,
): boolean {
  if (!eventExpectsTimeout) return false;
  return !!record?.timein && !record.timeout;
}

/**
 * Attendance rate as a percentage, or `null` when nobody is eligible.
 *
 * `null` rather than `0` because "no eligible students" and "nobody showed up" are
 * different facts, and a `YEAR`-scoped event legitimately matches zero students
 * (`domain-model.md` — nothing ever joins a student to a `YEAR` group).
 *
 * **`present` must be everyone who attended, late included.** Splitting late out of
 * the present count and then passing only the on-time figure here would silently
 * drop late arrivals from the rate and break agreement with
 * `GET /api/events/[eventId]/stats`.
 */
export function attendanceRate(
  present: number,
  eligible: number,
): number | null {
  if (eligible <= 0) return null;
  return (present / eligible) * 100;
}

/**
 * {@link attendanceRate} formatted for display — `"87.5%"`, or `"—"` when nobody
 * is eligible. This is the app's long-standing presentation; it replaces four
 * hand-rolled copies that all agreed on it.
 */
export function formatAttendanceRate(
  present: number,
  eligible: number,
): string {
  const rate = attendanceRate(present, eligible);
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}
