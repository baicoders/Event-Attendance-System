"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Button } from "@/globals/components/shad-cn/button";
import EventCard from "@/features/calendar/components/EventCard";
import useEvents, {
  useApproveEvent,
  useRejectEvent,
} from "@/globals/hooks/useEvents";
import { Loader2 } from "lucide-react";
import { Event } from "@/globals/types/events";
import Link from "next/link";
import { useAuth } from "@/globals/contexts/AuthContext";
import {
  toastDanger,
  toastSuccess,
  toastWarning,
} from "@/globals/components/shared/toasts";
import RejectionDialog from "@/globals/components/shared/RejectionDialog";
import type { EventFilter } from "@/features/calendar/utils/calendarUrlState";

type Props = {
  onDrawerOpen: (event: Event | null) => void;
  // Controlled by the page so the active filter can live in the URL.
  filter: EventFilter;
  onFilterChange: (filter: EventFilter) => void;
};

const EventsContainer = ({ onDrawerOpen, filter, onFilterChange }: Props) => {
  const { data, isLoading, error } = useEvents();
  const { user } = useAuth();
  const approveEvent = useApproveEvent();
  const rejectEvent = useRejectEvent();
  const [rejectionTarget, setRejectionTarget] = useState<Event | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { filteredEvents, counts, pendingEvents } = useMemo(() => {
    const events = data ?? [];
    const now = new Date();

    const classify = (event: Event) => {
      const start = new Date(event.start);
      const end = new Date(event.end ?? event.start);

      const isFinished = end < now;
      const isCurrent = start <= now && end >= now;
      const isUpcoming = start > now;

      return { isFinished, isCurrent, isUpcoming };
    };

    const baseSorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const finishedSorted = [...events]
      .filter((event) => classify(event).isFinished)
      .sort(
        (a, b) =>
          new Date(b.end ?? b.start).getTime() -
          new Date(a.end ?? a.start).getTime()
      );

    const counts = {
      current: events.filter((event) => classify(event).isCurrent).length,
      upcoming: events.filter((event) => classify(event).isUpcoming).length,
      finished: events.filter((event) => classify(event).isFinished).length,
      all: events.length,
    };

    const filteredEvents =
      filter === "current"
        ? baseSorted.filter((event) => classify(event).isCurrent)
        : filter === "upcoming"
        ? baseSorted.filter((event) => classify(event).isUpcoming)
        : filter === "finished"
        ? finishedSorted
        : baseSorted;

    const pendingEvents = events.filter((event) => event.status === "PENDING");

    return { filteredEvents, counts, pendingEvents };
  }, [data, filter]);

  const handleDrawerOpen = useCallback((event: Event) => onDrawerOpen(event), []);

  const handleApprove = (eventId: string) => {
    approveEvent.mutate(
      { id: eventId },
      {
        onSuccess: () => {
          toastSuccess("Event approved", "The event is now live.");
        },
        onError: (error) => {
          toastDanger(
            "Approval failed",
            error instanceof Error ? error.message : undefined
          );
        },
      }
    );
  };

  const handleReject = (event: Event) => {
    setRejectionTarget(event);
    setRejectionReason(event.rejectionReason ?? "Needs revisions");
  };

  const handleConfirmReject = () => {
    if (!rejectionTarget) return;

    const reason = rejectionReason.trim();
    if (!reason) {
      toastWarning("Rejection reason required");
      return;
    }

    rejectEvent.mutate(
      { id: rejectionTarget.id, reason },
      {
        onSuccess: () => {
          toastSuccess("Event rejected", reason);
          setRejectionTarget(null);
          setRejectionReason("");
        },
        onError: (error) => {
          toastDanger(
            "Rejection failed",
            error instanceof Error ? error.message : undefined
          );
        },
      }
    );
  };

  const isAdmin = user?.role === "ADMIN";
  const isProcessing = approveEvent.isPending || rejectEvent.isPending;

  return (
    <section className="w-full rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_42px_rgba(15,23,42,0.08)] backdrop-blur md:p-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
            Event Queue
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Events
          </h1>
          <p className="text-sm text-slate-500">
            Filter by status to find what you need fast.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
          <Button
            size="lg"
            className="h-11 rounded-xl bg-primary px-6 font-semibold text-white transition-transform hover:scale-[1.01]"
            onClick={() => onDrawerOpen(null)}
          >
            Create event
          </Button>
          {data?.length ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 rounded-xl border-slate-300 bg-white px-6 font-semibold text-slate-700 hover:bg-slate-100"
            >
              <Link href="/attendance">Take attendance</Link>
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="h-11 rounded-xl border-slate-300 bg-white px-6 font-semibold text-slate-500"
              disabled
            >
              Take attendance
            </Button>
          )}
        </div>
      </div>

      {isAdmin ? (
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_100%)] p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Pending event reviews
              </h2>
              <p className="text-xs text-slate-500">
                Approve or reject submitted events.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-600">
              {pendingEvents.length} pending
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {pendingEvents.length === 0 ? (
              <p className="text-xs text-slate-500">No pending events.</p>
            ) : (
              pendingEvents.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {event.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(event.start).toLocaleString()} | {event.category}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-500"
                      onClick={() => handleApprove(event.id)}
                      disabled={isProcessing}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReject(event)}
                      disabled={isProcessing}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))
            )}
            {pendingEvents.length > 6 ? (
              <p className="text-xs text-slate-500">
                + {pendingEvents.length - 6} more pending events.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-2">
        {(
          [
            { id: "current", label: "Current", count: counts.current },
            { id: "upcoming", label: "Upcoming", count: counts.upcoming },
            { id: "finished", label: "Finished", count: counts.finished },
            { id: "all", label: "All", count: counts.all },
          ] as const
        ).map((option) => {
          const isActive = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onFilterChange(option.id)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-all ${
                isActive
                  ? "border-transparent bg-primary text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {option.label} - {option.count}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/40 p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
            <span className="ml-2 text-lg">Loading events...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-red-600">
            <p className="font-medium">Failed to load events.</p>
            <span className="text-sm">Try refreshing the page</span>
          </div>
        ) : filteredEvents.length ? (
          filteredEvents.map((item) => (
            <EventCard
              key={item.id}
              event={item}
              onClick={() => handleDrawerOpen(item)}
            />
          ))
        ) : (
          <div className="flex items-center justify-center py-10 text-gray-500">
            <p>No events found for this filter.</p>
          </div>
        )}
      </div>

      <RejectionDialog
        isOpen={!!rejectionTarget}
        title={
          rejectionTarget ? `Reject "${rejectionTarget.title}"?` : "Reject event?"
        }
        description="Add a short note so the organizer knows what to fix before resubmitting."
        reason={rejectionReason}
        onReasonChange={setRejectionReason}
        onCancel={() => {
          setRejectionTarget(null);
          setRejectionReason("");
        }}
        onConfirm={handleConfirmReject}
        isSubmitting={rejectEvent.isPending}
        confirmLabel={rejectEvent.isPending ? "Rejecting..." : "Reject event"}
        cancelLabel="Cancel"
        reasonLabel="Rejection message"
        placeholder="Example: Please update the date range and add complete location details."
      />
    </section>
  );
};

export default EventsContainer;
