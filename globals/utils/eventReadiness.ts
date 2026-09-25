import type { EventCategory, EventStatus, UserStatus } from "@prisma/client";
import type { EventReadiness, ReadinessCheck } from "@/globals/types/eventReadiness";

export type ReadinessInput = {
  id: string;
  updatedAt: Date;
  status: EventStatus;
  category: EventCategory;
  start: Date;
  end: Date;
  allDay: boolean;
  isTimeout: boolean;
  createdById: string | null;
  owner: { name: string; status: UserStatus } | null;
  viewer: { id: string; role: "ADMIN" | "ORGANIZER" };
  eligibleCount: number | null;
  invalidAudience: boolean;
  evaluatedAt?: Date;
};

const manilaDateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila",
});
const manilaDayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
});

function manilaCalendarDay(date: Date): number {
  const parts = Object.fromEntries(manilaDayParts.formatToParts(date).map(({ type, value }) => [type, value]));
  return Number(`${parts.year}${parts.month}${parts.day}`);
}

/** A pure description of existing rules. Nothing here changes mutation policy. */
export function evaluateEventReadiness(input: ReadinessInput): EventReadiness {
  const checks: ReadinessCheck[] = [];
  const approved = input.status === "APPROVED";
  checks.push({
    id: "approval", state: approved ? "PASS" : "BLOCKED",
    code: approved ? "APPROVED" : `STATUS_${input.status}`,
    detail: approved ? "Approved for attendance." : `${input.status.toLowerCase()} — recording requires approval.`,
  });

  checks.push(input.invalidAudience
    ? { id: "audience", state: "WARNING", code: "AUDIENCE_INVALID", detail: "The saved audience has no valid target groups. Review its group selection." }
    : input.category === "YEAR"
      ? { id: "audience", state: "WARNING", code: "YEAR_GROUP_LIMITATION", detail: "YEAR matches group memberships, not the student's year or grade column." }
      : { id: "audience", state: "PASS", code: "AUDIENCE_VALID", detail: "The saved audience selection is valid." });

  checks.push(input.eligibleCount === null
    ? { id: "roster", state: "INFO", code: "AUDIENCE_COUNT_UNAVAILABLE", detail: "The saved audience cannot be counted until its group selection is corrected." }
    : input.eligibleCount === 0
      ? { id: "roster", state: "WARNING", code: "EMPTY_AUDIENCE", detail: "No students are currently eligible to record attendance." }
      : { id: "roster", state: "PASS", code: "ELIGIBLE_STUDENTS", detail: `${input.eligibleCount} currently eligible students.` });

  const start = input.start.getTime();
  const end = input.end.getTime();
  // Match the form's inclusive calendar-day rule using the Manila dates shown
  // to operators. Server process timezone must not change the result.
  // This does not add a recording time window.
  const validSchedule = Number.isFinite(start) && Number.isFinite(end) &&
    (input.allDay
      ? manilaCalendarDay(input.end) >= manilaCalendarDay(input.start)
      : end >= start);
  checks.push(validSchedule
    ? { id: "schedule", state: "PASS", code: "SCHEDULE_VALID", detail: `${manilaDateTime.format(input.start)} to ${manilaDateTime.format(input.end)}${input.allDay ? " (all day)" : ""}. Schedule does not limit recording time.` }
    : { id: "schedule", state: "WARNING", code: "SCHEDULE_INVALID", detail: "The saved schedule is invalid. Review the event dates." });

  checks.push(!input.owner
    ? { id: "owner", state: "WARNING", code: "OWNER_MISSING", detail: "No owner is available. Contact an admin for help with event management." }
    : input.owner.status !== "ACTIVE"
      ? { id: "owner", state: "WARNING", code: "OWNER_INACTIVE", detail: `${input.owner.name} is inactive. Contact an admin for help with event management.` }
      : { id: "owner", state: "PASS", code: "OWNER_ACTIVE", detail: input.owner.name });

  const canManageMode = approved && (input.viewer.role === "ADMIN" || input.createdById === input.viewer.id);
  checks.push({
    id: "recordingMode", state: "INFO", code: input.isTimeout ? "TIME_OUT" : "TIME_IN",
    detail: input.isTimeout
      ? `Time-out mode. A prior time-in is required.${canManageMode ? " You can change the mode." : " Contact the owner or an admin to change the mode."}`
      : `Time-in mode.${canManageMode ? " You can change the mode." : " Contact the owner or an admin to change the mode."}`,
  });

  return {
    eventId: input.id, eventUpdatedAt: input.updatedAt.toISOString(),
    evaluatedAt: (input.evaluatedAt ?? new Date()).toISOString(),
    basis: "CURRENT_ROSTER_SAVED_EVENT", approvalStatus: input.status,
    recordingMode: input.isTimeout ? "TIME_OUT" : "TIME_IN",
    recordingAllowed: approved, canManageMode, eligibleCount: input.eligibleCount,
    summary: !approved ? "NOT_APPROVED" : checks.some((check) => check.state === "WARNING") ? "ATTENTION" : "CHECKS_PASSED",
    checks,
  };
}
