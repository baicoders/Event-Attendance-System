"use client";

import FullCalendar from "@fullcalendar/react";
import type { DayHeaderContentArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import React, { useMemo, useRef, useCallback } from "react";
import { useSidebar } from "@/globals/contexts/SidebarContext";
import CalendarEventCard from "@/features/calendar/components/CalendarEventCard";
import useEvents, { useSaveEvent } from "@/globals/hooks/useEvents";
import { CalendarProps } from "@/features/calendar/types/calendar";
import {
  CALENDAR_CONFIG,
  CALENDAR_HEADER_TOOLBAR,
} from "@/features/calendar/constants/calendarConfig";
import { transformEventsForCalendar } from "@/features/calendar/utils/calendar";
import { useCalendarResize } from "@/features/calendar/hooks/useCalendarResize";
import { useDraftEvent } from "@/features/calendar/hooks/useDraftEvent";
import { useCalendarEvents } from "@/features/calendar/hooks/useCalendarEvents";
import { useAuth } from "@/globals/contexts/AuthContext";

const Calendar = ({
  onSelectDate,
  isDrawerOpen,
  onEditEvent,
}: CalendarProps) => {
  const { isExpanded: isSidebarExpanded } = useSidebar();
  const { user } = useAuth();
  const { data } = useEvents();
  const { mutateAsync: saveEvent } = useSaveEvent();
  const calendarRef = useRef<FullCalendar | null>(null);

  // Transform events for FullCalendar format; per-event editability follows
  // the server's rules (own drafts/rejected, or admin)
  const transformedEvents = useMemo(
    () => transformEventsForCalendar(data || [], user),
    [data, user]
  );

  // Custom hooks for managing component behavior
  useCalendarResize(calendarRef, isSidebarExpanded);

  const { draftEvent, handleSelectDate } = useDraftEvent(
    isDrawerOpen,
    onSelectDate
  );

  const { handleEventClick, handleEventResize, handleEventDrop } =
    useCalendarEvents(data, saveEvent, onEditEvent);

  // Combine transformed events with draft event
  const allEvents = useMemo(
    () => [...transformedEvents, ...(draftEvent ? [draftEvent] : [])],
    [transformedEvents, draftEvent]
  );

  const weekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
      }),
    []
  );

  const shortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
      }),
    []
  );

  const fullWeekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
      }),
    []
  );

  const renderDayHeader = useCallback(
    (arg: DayHeaderContentArg) => {
      if (arg.view.type === "timeGridWeek") {
        return (
          <div className="fc-simple-week-header">
            <span className="fc-simple-weekday">
              {weekdayFormatter.format(arg.date)}
            </span>
            <span className="fc-simple-weekdate">
              {shortDateFormatter.format(arg.date)}
            </span>
          </div>
        );
      }

      if (arg.view.type === "timeGridDay") {
        return (
          <div className="fc-simple-day-header">
            {fullWeekdayFormatter.format(arg.date)}
          </div>
        );
      }

      return arg.text;
    },
    [weekdayFormatter, shortDateFormatter, fullWeekdayFormatter]
  );

  return (
    <div className="calendar-shell relative h-full w-full overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_52%,#f8fafc_100%)] p-3 shadow-[0_24px_55px_rgba(15,23,42,0.08)] md:p-5">
      <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-indigo-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-14 h-48 w-48 rounded-full bg-sky-300/20 blur-3xl" />

      <div className="event-calendar h-full">
        <FullCalendar
          ref={calendarRef}
          height="100%"
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={CALENDAR_HEADER_TOOLBAR}
          buttonText={{
            today: "Today",
            month: "Month",
            week: "Week",
            day: "Day",
          }}
          dayHeaderContent={renderDayHeader}
          allDayText="All Day"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          scrollTime="06:00:00"
          slotLabelInterval="01:00:00"
          slotLabelFormat={{
            hour: "numeric",
            meridiem: "short",
          }}
          selectable
          select={handleSelectDate}
          eventClick={handleEventClick}
          eventResize={handleEventResize}
          eventDrop={handleEventDrop}
          events={allEvents}
          slotDuration={CALENDAR_CONFIG.SLOT_DURATION}
          defaultTimedEventDuration={CALENDAR_CONFIG.DEFAULT_TIMED_EVENT_DURATION}
          snapDuration={CALENDAR_CONFIG.SNAP_DURATION}
          editable
          nowIndicator
          // No validRange: clipping the visible range to "today onward" hid the
          // earlier weekday columns, shortened the week title, and blocked
          // viewing historical events entirely. Past *scheduling* is instead
          // rejected per-interaction (see useDraftEvent / useCalendarEvents), so
          // history stays fully visible and navigable while still un-schedulable.
          eventContent={(arg) => <CalendarEventCard arg={arg} />}
        />
      </div>
    </div>
  );
};

export default Calendar;
