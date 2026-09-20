"use client";

import Calendar from "@/features/calendar/components/Calendar";
import EventsContainer from "@/features/calendar/components/EventsContainer";
import { Event } from "@/globals/types/events";
import type { CalendarView } from "@/features/calendar/types/calendar";
import {
  DEFAULT_CALENDAR_VIEW,
  DEFAULT_EVENT_FILTER,
  isValidCalendarView,
  isValidEventFilter,
  isValidYmd,
  type EventFilter,
} from "@/features/calendar/utils/calendarUrlState";
import { useUrlSearchParams } from "@/globals/hooks/useUrlSearchParams";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// The 700+ line drawer pulls in react-hook-form, zod, the date pickers and
// the checkbox/combobox stack. It's only shown after a create/edit action,
// so keep it out of the calendar's initial bundle.
const EventDrawer = dynamic(
  () => import("@/features/calendar/components/EventDrawer"),
  { ssr: false }
);

/**
 * CalendarPage Component
 *
 * Orchestrates the calendar feature and persists non-sensitive navigation
 * context (view, date, event filter) in allowlisted URL parameters so a refresh
 * restores where the user was.
 */
const CalendarPageInner = () => {
  const { searchParams, setParams } = useUrlSearchParams();
  const hasOpenedCreate = useRef(false);

  // Drawer visibility state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Drawer mode: "create" for new events, "edit" for existing events
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  // Event data for the drawer form (null in create mode)
  const [formData, setFormData] = useState<Partial<Event> | null>(null);

  // --- URL-backed navigation context (validated + canonicalized) ---
  const rawView = searchParams.get("view");
  const rawFilter = searchParams.get("eventFilter");
  const rawDate = searchParams.get("date");

  const view: CalendarView = isValidCalendarView(rawView)
    ? rawView
    : DEFAULT_CALENDAR_VIEW;
  const eventFilter: EventFilter = isValidEventFilter(rawFilter)
    ? rawFilter
    : DEFAULT_EVENT_FILTER;
  // Only forward a date we can trust; an invalid one is dropped rather than
  // handed to FullCalendar.
  const initialDate = isValidYmd(rawDate) ? rawDate : undefined;

  // Canonicalize: if a param is present but invalid, fix it to a safe value (or
  // drop a bad date). Absent params keep the calendar's defaults without being
  // force-written. setParams' no-op guard prevents update loops.
  useEffect(() => {
    const changes: Record<string, string | null> = {};
    if (rawView !== null && !isValidCalendarView(rawView)) {
      changes.view = DEFAULT_CALENDAR_VIEW;
    }
    if (rawFilter !== null && !isValidEventFilter(rawFilter)) {
      changes.eventFilter = DEFAULT_EVENT_FILTER;
    }
    if (rawDate !== null && !isValidYmd(rawDate)) {
      changes.date = null;
    }
    if (Object.keys(changes).length > 0) setParams(changes);
  }, [rawView, rawFilter, rawDate, setParams]);

  const handleViewDateChange = useCallback(
    (nextView: CalendarView, nextDate: string) => {
      setParams({ view: nextView, date: nextDate });
    },
    [setParams]
  );

  const handleFilterChange = useCallback(
    (nextFilter: EventFilter) => {
      setParams({ eventFilter: nextFilter });
    },
    [setParams]
  );

  // --- Drawer handlers ---
  const handleDrawerOpen = useCallback((event: Partial<Event> | null) => {
    setFormData(event);
    setDrawerMode(event?.id ? "edit" : "create");
    setIsDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setFormData(null);
    setIsDrawerOpen(false);
  }, []);

  const handleSelectDate = useCallback(
    (start: Date, end: Date) => {
      handleDrawerOpen({ start, end });
    },
    [handleDrawerOpen]
  );

  const handleEditEvent = useCallback(
    (event: Event) => {
      handleDrawerOpen(event);
    },
    [handleDrawerOpen]
  );

  // create=1 is a one-shot action, not persistent state: open the create drawer
  // once, then strip the param so a later refresh doesn't reopen a discarded
  // form. Strip synchronously via history.replaceState rather than the async
  // router, so a deferred writer (the calendar's datesSet, composed off
  // window.location) can't re-add it and a refresh never sees it.
  useEffect(() => {
    if (searchParams.get("create") === "1" && !hasOpenedCreate.current) {
      hasOpenedCreate.current = true;
      handleDrawerOpen(null);

      const params = new URLSearchParams(window.location.search);
      params.delete("create");
      const query = params.toString();
      const path = window.location.pathname;
      window.history.replaceState(
        window.history.state,
        "",
        query ? `${path}?${query}` : path
      );
    }
  }, [searchParams, handleDrawerOpen]);

  return (
    <div className="flex flex-col flex-1 bg-white p-4 md:p-8">
      <section className="h-[calc(100vh-2.5rem)] md:h-[calc(100vh-3.5rem)]">
        {/* Calendar Component - displays events and allows date selection */}
        <Calendar
          isDrawerOpen={isDrawerOpen}
          onSelectDate={handleSelectDate}
          onEditEvent={handleEditEvent}
          initialView={view}
          initialDate={initialDate}
          onViewDateChange={handleViewDateChange}
        />
      </section>

      {/* Events Container - displays list of upcoming/all events */}
      <section className="mt-6">
        <EventsContainer
          onDrawerOpen={handleDrawerOpen}
          filter={eventFilter}
          onFilterChange={handleFilterChange}
        />
      </section>

      {/* Event Drawer - form for creating/editing events */}
      <EventDrawer
        key={formData?.id} // To reset the form whenever data changes lol
        mode={drawerMode}
        initialData={formData ?? undefined}
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
      />
    </div>
  );
};

// useSearchParams needs a Suspense boundary during prerender.
const CalendarPage = () => (
  <Suspense fallback={null}>
    <CalendarPageInner />
  </Suspense>
);

export default CalendarPage;
