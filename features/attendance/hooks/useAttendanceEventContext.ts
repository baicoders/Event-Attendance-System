"use client";

import { useEffect } from "react";
import { useFetchApprovedEvents, useFetchEvent } from "@/globals/hooks/useEvents";
import { useUrlSearchParams } from "@/globals/hooks/useUrlSearchParams";

export function useAttendanceEventContext(clearInvalid = false) {
  const { searchParams, setParams } = useUrlSearchParams();
  const eventId = searchParams.get("eventId");
  const approved = useFetchApprovedEvents();
  const isListed = !!eventId && !!approved.data?.some((event) => event.id === eventId);
  const live = useFetchEvent(isListed ? eventId! : undefined, true);
  const selectedEvent = isListed && !approved.isError && !live.isError && live.data?.status === "APPROVED"
    ? live.data : null;
  const definitelyInvalid = !!eventId && approved.isSuccess && !isListed;

  useEffect(() => {
    if (clearInvalid && definitelyInvalid) setParams({ eventId: null });
  }, [clearInvalid, definitelyInvalid, setParams]);

  return {
    eventId,
    selectedEvent,
    isRestoring: !!eventId && !selectedEvent && !definitelyInvalid &&
      (approved.isLoading || live.isLoading),
    isUnavailable: definitelyInvalid || (!!eventId && live.isSuccess && live.data?.status !== "APPROVED"),
    hasRefreshError: approved.isError || live.isError,
    lastCheckedAt: live.dataUpdatedAt,
    refetchEvent: live.refetch,
    retryContext: () => approved.isError ? approved.refetch() : live.refetch(),
    selectEventId: (id: string) => setParams({ eventId: id }),
  };
}
