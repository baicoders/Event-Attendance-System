import { Event } from "@/globals/types/events";
import { AuthUser } from "@/globals/contexts/AuthContext";
import { CALENDAR_CONFIG } from "@/features/calendar/constants/calendarConfig";
import { CalendarEvent, DraftEvent } from "@/features/calendar/types/calendar";

/**
 * Mirrors the server's edit rules: admins can move any event; organizers can
 * only move their own drafts and rejected events (approved/pending are locked).
 */
export const canEditEvent = (event: Event, user: AuthUser | null): boolean => {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return (
    event.createdById === user.id &&
    (event.status === "DRAFT" || event.status === "REJECTED")
  );
};

export const transformEventsForCalendar = (
  events: Event[],
  user: AuthUser | null
): CalendarEvent[] => {
  return events?.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: canEditEvent(event, user),
    extendedProps: {
      status: event.status,
    },
  })) ?? [];
};

/**
 * True when an entire [start, end) range lies at or before "now" - i.e. the
 * whole slot/event is in the past. Used to block past *scheduling* interactions
 * (creating a new event, or dragging/resizing an editable one) without hiding
 * historical events from view. A range that merely starts in the past but ends
 * at or after "now" is NOT wholly past, so events and selections spanning the
 * current moment stay interactive.
 */
export const isRangeWhollyPast = (
  start: Date,
  end: Date,
  now: Date = new Date()
): boolean => end.getTime() <= now.getTime();

export const createDraftEvent = (start: Date, end: Date): DraftEvent => {
  return {
    id: CALENDAR_CONFIG.DRAFT_EVENT_ID,
    start,
    end,
    backgroundColor: CALENDAR_CONFIG.DRAFT_EVENT_COLOR,
    editable: false,
  };
};

export const findEventById = (events: Event[] | undefined, id: string): Event | null => {
  if (!events) return null;
  
  const event = events.find((e) => e.id === id);
  if (!event) {
    console.warn(`Event with id ${id} not found`);
    return null;
  }
  return event;
};
