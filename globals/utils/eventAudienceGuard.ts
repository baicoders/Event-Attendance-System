import { prisma } from "@/globals/libs/prisma";
import { hasEventAudienceChanged } from "@/globals/utils/events";

export { AUDIENCE_CHANGE_HAS_RECORDS_CODE } from "@/globals/utils/events";

type AudienceEvent = {
  id: string;
  status: string;
  category: string;
  includedGroups: { id: string }[];
};

type AudiencePayload = {
  category: string;
  includedGroups?: string[] | null;
  acknowledgeAudienceChange?: boolean;
};

/**
 * The audience-rescope guard shared by both event-edit routes
 * (`POST /api/events` and `PATCH /api/events/[eventId]`).
 *
 * Eligibility is computed live from an event's current `category` /
 * `includedGroups`, so changing them on an already-scanned event silently
 * rewrites its report. This mirrors the delete-path `EVENT_HAS_RECORDS` guard:
 * if the audience changed and attendance already exists, the caller must
 * explicitly acknowledge the consequence (option 2), otherwise the change is
 * rejected.
 *
 * Returns an error message to send back, or `null` when the edit is allowed.
 * The attendance count is only queried for an APPROVED event whose audience
 * actually changed, so benign edits and drafts never pay for the count.
 */
export async function getEventAudienceChangeError(
  event: AudienceEvent,
  payload: AudiencePayload,
): Promise<string | null> {
  if (event.status !== "APPROVED") return null;
  if (!hasEventAudienceChanged(event, payload)) return null;

  const attendanceCount = await prisma.record.count({
    where: { eventId: event.id },
  });

  if (attendanceCount === 0) return null;
  if (payload.acknowledgeAudienceChange) return null;

  return `This event already has ${attendanceCount} attendance record(s). Changing its category or included groups will change who counts toward its report.`;
}
