import { Event, EventForm } from "@/globals/types/events";

/**
 * Filters and sorts events so that only upcoming or ongoing ones remain.
 *
 * Rules:
 * - Include if start date is today or later
 * - Include if end date is today (even if start was before today)
 * - Sort ascending by start date
 */
export function getUpcomingEvents(data?: Event[]): Event[] {
  if (!data) return [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return data
    .filter((event) => {
      const start = new Date(event.start);
      const end = event.end ? new Date(event.end) : start;

      return start >= todayStart || end >= todayStart;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * Displays only the date portion of the datetime
 */
export function normalizeAllDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatEventPayload(data: EventForm): EventForm {
  return {
    ...data,
    start: data.allDay ? normalizeAllDay(data.start) : data.start,
    end: data.allDay ? normalizeAllDay(data.end) : data.end,
  };
}

type CurrentAudience = {
  // Optional so a `Partial<Event>` (the drawer's `initialData`) is accepted;
  // callers pass a real event, where both fields are always present.
  category?: string;
  includedGroups?: { id: string }[] | null;
};

type IncomingAudience = {
  category: string;
  // `null`/`undefined` means the edit does not touch the group set (the PATCH
  // content-edit path only writes groups when the field is present), so leave
  // that half of the comparison unchanged rather than reading it as "cleared".
  includedGroups?: string[] | null;
};

/**
 * Whether an incoming event edit changes *who counts as an attendee* —
 * `category` or `includedGroups`. Compares by set membership, not order or
 * mere presence, so re-submitting an unchanged audience (e.g. calendar
 * drag/resize, which echoes the current values) does not count as a change.
 *
 * Shared by the server audience guard and the EventDrawer's pre-save warning
 * so both agree on what "changed" means.
 */
export function hasEventAudienceChanged(
  current: CurrentAudience,
  incoming: IncomingAudience,
): boolean {
  if (current.category !== incoming.category) return true;

  if (incoming.includedGroups == null) return false;

  const currentIds = new Set((current.includedGroups ?? []).map((g) => g.id));
  const incomingIds = new Set(incoming.includedGroups);

  if (currentIds.size !== incomingIds.size) return true;

  for (const id of incomingIds) {
    if (!currentIds.has(id)) return true;
  }

  return false;
}

export function toDate(str: string) {
  return new Date(str);
}

/**
 * Machine-readable code returned when an admin tries to change an APPROVED
 * event's audience after attendance has been recorded, without acknowledging
 * the consequence. The client branches on this to show the confirmation and
 * re-send with `acknowledgeAudienceChange: true`.
 *
 * Kept here (a client-safe module) rather than in the server-only guard so the
 * EventDrawer can branch on the same constant.
 */
export const AUDIENCE_CHANGE_HAS_RECORDS_CODE = "AUDIENCE_CHANGE_HAS_RECORDS";
