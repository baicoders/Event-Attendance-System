import { useCallback } from "react";
import { EventClickArg, EventDropArg } from "@fullcalendar/core";
import { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Event, EventForm } from "@/globals/types/events";
import { CALENDAR_CONFIG } from "@/features/calendar/constants/calendarConfig";
import {
  findEventById,
  isRangeWhollyPast,
} from "@/features/calendar/utils/calendar";
import { toastDanger, toastWarning } from "@/globals/components/shared/toasts";

// The save API validates includedGroups as an array of group ids, so a
// calendar move must send ids - not the Group[] relation carried on Event.
const toEventForm = (event: Event, patch: Partial<EventForm>): EventForm => ({
  id: event.id,
  title: event.title,
  location: event.location,
  category: event.category,
  includedGroups: event.includedGroups.map((g) => g.id),
  description: event.description,
  start: event.start,
  end: event.end,
  allDay: event.allDay,
  ...patch,
});

export const useCalendarEvents = (
  data: Event[] | undefined,
  saveEvent: (event: EventForm) => Promise<unknown>,
  onEditEvent?: (event: Event) => void
) => {
  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      if (info.event.id === CALENDAR_CONFIG.DRAFT_EVENT_ID || !onEditEvent) {
        return;
      }

      const event = findEventById(data, info.event.id);
      if (event) {
        onEditEvent(event);
      }
    },
    [data, onEditEvent]
  );

  const handleEventResize = useCallback(
    async (info: EventResizeDoneArg) => {
      if (info.event.id === CALENDAR_CONFIG.DRAFT_EVENT_ID) {
        info.revert();
        return;
      }

      const event = findEventById(data, info.event.id);
      if (!event) {
        info.revert();
        return;
      }

      const newStart = info.event.start!;
      const newEnd = info.event.end ?? info.event.start!;

      // Reject a resize that leaves the event entirely in the past. Client-side
      // only (no server date policy); the move is reverted so the calendar
      // never keeps an optimistic change that the user can't actually schedule.
      if (isRangeWhollyPast(newStart, newEnd)) {
        info.revert();
        toastWarning(
          "Can't move an event into the past",
          "Choose a time from now onward."
        );
        return;
      }

      const updatedEvent = toEventForm(event, {
        start: newStart,
        end: newEnd,
        allDay: info.event.allDay,
      });

      try {
        await saveEvent(updatedEvent);
      } catch (error) {
        info.revert();
        toastDanger(
          "Couldn't move event",
          error instanceof Error ? error.message : undefined
        );
      }
    },
    [data, saveEvent]
  );

  const handleEventDrop = useCallback(
    async (info: EventDropArg) => {
      if (info.event.id === CALENDAR_CONFIG.DRAFT_EVENT_ID) {
        info.revert();
        return;
      }

      const event = findEventById(data, info.event.id);
      if (!event) {
        info.revert();
        return;
      }

      const newStart = info.event.start!;
      const newEnd = info.event.end ?? info.event.start!;

      // Reject a drop that leaves the event entirely in the past (client-side
      // only). Reverting avoids stranding an optimistic move the user can't
      // actually schedule.
      if (isRangeWhollyPast(newStart, newEnd)) {
        info.revert();
        toastWarning(
          "Can't move an event into the past",
          "Choose a time from now onward."
        );
        return;
      }

      const updatedEvent = toEventForm(event, {
        start: newStart,
        end: newEnd,
        allDay: info.event.allDay,
      });

      try {
        await saveEvent(updatedEvent);
      } catch (error) {
        info.revert();
        toastDanger(
          "Couldn't move event",
          error instanceof Error ? error.message : undefined
        );
      }
    },
    [data, saveEvent]
  );

  return { handleEventClick, handleEventResize, handleEventDrop };
};