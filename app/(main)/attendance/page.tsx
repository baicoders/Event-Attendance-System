"use client";

import React, { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import AttendancePageHeader from "@/features/attendance/components/AttendancePageHeader";
import AttendanceSection from "@/features/attendance/components/AttendanceSection";
import AttendanceRecordsTable from "@/features/attendance/components/AttendanceRecordsTable";
import {
  useFetchApprovedEvents,
  useFetchEvent,
} from "@/globals/hooks/useEvents";
import { useUrlSearchParams } from "@/globals/hooks/useUrlSearchParams";
import { page } from "@/globals/constants/designTokens";

const RestoringState = () => (
  <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-gray-500 shadow-sm">
    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
    <span className="text-lg">Restoring event…</span>
  </div>
);

const AttendancePageInner = () => {
  const { searchParams, setParams } = useUrlSearchParams();
  const eventId = searchParams.get("eventId");

  // The selected event lives in the URL (/attendance?eventId=…) so a refresh
  // restores exactly the same event, and it's shareable and page-scoped.
  const {
    data: approvedEvents,
    isLoading: isApprovedLoading,
    isSuccess: isApprovedSuccess,
  } = useFetchApprovedEvents();

  // A crafted URL must not activate a draft/rejected/deleted/invisible event:
  // only ids present in the approved-events list are honoured.
  const isEventApproved =
    !!eventId && !!approvedEvents?.some((e) => e.id === eventId);
  const validatedId = isEventApproved ? eventId : undefined;

  // Hold only the id and derive ONE live event object from it, so the header,
  // scanner, manual actions, and records table all share the same fresh event
  // (isTimeout, ownership) instead of a stale selection copy.
  const { data: liveEvent, isLoading: isLiveLoading } = useFetchEvent(
    validatedId,
    true,
  );
  const selectedEvent = liveEvent ?? null;

  // Drop an invalid eventId only after a *definitive* result: the approved list
  // loaded successfully and the id isn't in it. Never remove it while the query
  // is loading or transiently failing, so a refresh over a flaky network keeps
  // the selection. Unrelated params are preserved.
  useEffect(() => {
    if (eventId && isApprovedSuccess && !isEventApproved) {
      setParams({ eventId: null });
    }
  }, [eventId, isApprovedSuccess, isEventApproved, setParams]);

  const handleSelectEventId = (id: string) => {
    setParams({ eventId: id });
  };

  // While an id in the URL is still being validated/loaded, show a small
  // restoring state instead of flashing "Select an event". We're restoring
  // unless we've definitively concluded the id is invalid (→ it will be cleared
  // and the normal no-selection state shows).
  const definitelyInvalid = !!eventId && isApprovedSuccess && !isEventApproved;
  const isRestoring =
    !!eventId &&
    !selectedEvent &&
    !definitelyInvalid &&
    (isApprovedLoading || isLiveLoading || isEventApproved);

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <AttendancePageHeader
          selectedEvent={selectedEvent}
          onSelectEventId={handleSelectEventId}
        />
        {isRestoring ? (
          <RestoringState />
        ) : (
          <>
            <AttendanceSection selectedEvent={selectedEvent} />
            <AttendanceRecordsTable selectedEvent={selectedEvent} />
          </>
        )}
      </div>
    </section>
  );
};

// useSearchParams needs a Suspense boundary during prerender.
const AttendancePage = () => (
  <Suspense fallback={null}>
    <AttendancePageInner />
  </Suspense>
);

export default AttendancePage;
