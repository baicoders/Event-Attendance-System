"use client";

import React, { useMemo } from "react";
import { PiExport } from "react-icons/pi";
import { IoMdCheckmarkCircleOutline } from "react-icons/io";
import { FaUserGroup } from "react-icons/fa6";
import { VscPercentage } from "react-icons/vsc";
import { IconType } from "react-icons/lib";
import ButtonWithIcon from "@/globals/components/shared/ButtonWithIcon";
import ComboBox, { ComboBoxValue } from "@/globals/components/shared/ComboBox";
import DataCard from "@/features/attendance/components/DataCard";
import {
  useFetchApprovedEvents,
  useStatsOfEvent,
} from "@/globals/hooks/useEvents";
import { Event } from "@/globals/types/events";
import TurnOnTimeoutMode from "@/features/attendance/components/TurnOnTimeoutMode";
import Link from "next/link";
import { IoDocument } from "react-icons/io5";
import { useAuth } from "@/globals/contexts/AuthContext";
import PageHeader from "@/globals/components/shared/PageHeader";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { surface } from "@/globals/constants/designTokens";
import { formatAttendanceRate } from "@/globals/utils/attendance";
import { cn } from "@/globals/libs/shad-cn";
import EventReadinessDialog from "@/features/calendar/components/EventReadinessDialog";

type Props = {
  // Already the live event (the page derives it from useFetchEvent).
  selectedEvent: Event | null;
  // Communicates the chosen event *id* - the page owns the (URL-backed) state
  // and derives the live event, so the header never passes a copied Event.
  onSelectEventId: (eventId: string) => void;
};

// Below `sm`, three stacked DataCards read as three separate decisions to
// scan past rather than one glance - so the mobile view collapses them into
// a single card with the same three values side by side instead.
const CompactStat = ({
  icon: Icon,
  label,
  value,
  isLoading,
}: {
  icon: IconType;
  label: string;
  value: string;
  isLoading: boolean;
}) => (
  <div className="flex flex-1 flex-col items-center gap-1 px-2 py-3 text-center">
    <Icon className="size-4 text-slate-400" />
    <span className="text-lg font-mono font-semibold text-slate-900">
      {isLoading ? "—" : value}
    </span>
    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
      {label}
    </span>
  </div>
);

const AttendancePageHeader: React.FC<Props> = ({
  selectedEvent,
  onSelectEventId,
}) => {
  const { user } = useAuth();
  const { data: events, isLoading: isEventsLoading } = useFetchApprovedEvents();
  const currentEvent = selectedEvent;
  const canManageEvent =
    !!currentEvent &&
    (user?.role === "ADMIN" || currentEvent.createdById === user?.id);
  const {
    data: eventStats,
    isLoading: isStatsLoading,
    isError: isStatsError,
  } = useStatsOfEvent(selectedEvent?.id, true);

  // Compute attendance rate
  const attendanceRate = useMemo(
    () =>
      formatAttendanceRate(eventStats?.present ?? 0, eventStats?.eligible ?? 0),
    [eventStats],
  );

  // Build combobox options
  const eventChoices: ComboBoxValue[] = useMemo(() => {
    if (!events) return [];
    return events.map((e) => ({
      value: e.id,
      label: e.title,
    }));
  }, [events]);

  // Handle selecting a new event. Only surface ids we can see in the approved
  // list; the page validates again before enabling the workflow.
  const handleSelectEvent = (eventId: string) => {
    const found = events?.find((e) => e.id === eventId);
    if (!found) {
      console.warn("Selected event not found in events list");
      return;
    }
    onSelectEventId(found.id);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* === Header Top === */}
      <PageHeader
        title="Attendance Tracking"
        variant="plain"
        actions={
          <>
            {/* View Report Button - only navigable once an event is selected,
                so it can't link to /reports/events/undefined. */}
            {selectedEvent?.id ? (
              <Link
                href={`/reports/events/${selectedEvent.id}`}
                target="_blank"
              >
                <ButtonWithIcon variant="ghost" icon={IoDocument}>
                  View Report
                </ButtonWithIcon>
              </Link>
            ) : (
              <ButtonWithIcon variant="ghost" icon={IoDocument} disabled>
                View Report
              </ButtonWithIcon>
            )}

            {/* Export is not implemented yet - disabled rather than shown as a
                working control (see deferred export PR). */}
            <ButtonWithIcon icon={PiExport} disabled title="Export coming soon">
              Export
            </ButtonWithIcon>
          </>
        }
      />

      {(selectedEvent &&
        !isEventsLoading &&
        !isStatsLoading &&
        attendanceRate === "—") ||
      isStatsError ? (
        <div className="flex flex-col gap-1">
          {selectedEvent &&
            !isEventsLoading &&
            !isStatsLoading &&
            attendanceRate === "—" && (
              <p className="text-sm text-rose-600">
                No eligible students found for this event.
              </p>
            )}
          {isStatsError && (
            <p className="text-sm text-rose-500">
              Error fetching attendance data.
            </p>
          )}
        </div>
      ) : null}

      {/* === Header Bottom === */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
        {/* Event Selection + mode indicator */}
        <div className={cn(surface.card, "flex flex-col gap-3 p-4")}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">
              Select Event
            </p>
            {currentEvent && (
              <StatusBadge
                tone={currentEvent.isTimeout ? "warning" : "info"}
                withDot
              >
                {currentEvent.isTimeout ? "Time-out mode" : "Time-in mode"}
              </StatusBadge>
            )}
          </div>
          <ComboBox
            choices={eventChoices}
            selectedValue={selectedEvent?.id ?? ""}
            onSelect={handleSelectEvent}
            placeholder={
              isEventsLoading ? "Loading events..." : "Select an event"
            }
            searchFallbackMsg="No events found"
          />
          <TurnOnTimeoutMode
            eventId={currentEvent?.id}
            isTimeout={currentEvent?.isTimeout ?? false}
            canToggle={canManageEvent}
          />
          {currentEvent && <EventReadinessDialog key={currentEvent.id} eventId={currentEvent.id}>
            <button type="button" className="self-start rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              Event checks
            </button>
          </EventReadinessDialog>}
        </div>

        {/* Stats Cards */}
        <div>
          {/* Below sm: one combined card instead of three stacked ones. */}
          <div
            className={cn(
              surface.card,
              "grid grid-cols-3 divide-x divide-slate-200 sm:hidden"
            )}
          >
            <CompactStat
              icon={IoMdCheckmarkCircleOutline}
              label="Present"
              value={String(eventStats?.present ?? "—")}
              isLoading={isStatsLoading}
            />
            <CompactStat
              icon={FaUserGroup}
              label="Registered"
              value={String(eventStats?.eligible ?? "—")}
              isLoading={isStatsLoading}
            />
            <CompactStat
              icon={VscPercentage}
              label="Rate"
              value={attendanceRate}
              isLoading={isStatsLoading}
            />
          </div>

          {/* sm and up: the three full stat cards. */}
          <div className="hidden grid-cols-1 gap-3 sm:grid sm:grid-cols-3">
            <DataCard
              label="Present"
              description="Students checked in"
              icon={IoMdCheckmarkCircleOutline}
              value={String(eventStats?.present ?? "—")}
              isLoading={isStatsLoading}
              className={cn(surface.card, "min-w-0")}
            />
            <DataCard
              label="Total Registered"
              description="Eligible attendees"
              icon={FaUserGroup}
              value={String(eventStats?.eligible ?? "—")}
              isLoading={isStatsLoading}
              className={cn(surface.card, "min-w-0")}
            />
            <DataCard
              label="Attendance Rate"
              description="Current percentage"
              icon={VscPercentage}
              value={attendanceRate}
              isLoading={isStatsLoading}
              className={cn(surface.card, "min-w-0")}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttendancePageHeader;
