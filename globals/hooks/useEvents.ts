import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Event, EventAPI, EventForm, EventStats } from "@/globals/types/events";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";

type EventScope = "visible" | "mine";
type UseEventsOptions = {
  scope?: EventScope;
  status?: Event["status"];
};

// Transform function to make sure that the dates are actually a Date object
const transformEvent = (e: EventAPI): Event => ({
  ...e,
  start: new Date(e.start),
  end: new Date(e.end),
  createdAt: new Date(e.createdAt),
  updatedAt: new Date(e.updatedAt),
});

/**
 * Creates or Edit an event
 *
 * @returns created or edited Event object
 */
export const useSaveEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event: EventForm) => {
      // The API returns string dates; transform so the resolved value is a
      // real Event (Date objects), matching what the type promises.
      const saved = await fetchApi<EventAPI>("/api/events", {
        method: "POST",
        body: JSON.stringify(event),
        headers: { "Content-Type": "application/json" },
      });
      return transformEvent(saved);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
    },
  });
};

const useEventAction = (action: "SUBMIT" | "APPROVE" | "REJECT") => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { id: string; reason?: string }) => {
      const updated = await fetchApi<EventAPI>(`/api/events/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "REJECT" ? { action, reason: payload.reason } : { action },
        ),
      });
      return transformEvent(updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
    },
  });
};

export const useSubmitEvent = () => useEventAction("SUBMIT");
export const useApproveEvent = () => useEventAction("APPROVE");
export const useRejectEvent = () => useEventAction("REJECT");

/**
 * Deletes an event
 *
 * @returns deleted Event
 */
export const useDeleteEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return fetchApi<null>(`/api/events/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
    },
  });
};

/**
 * Fetches stats from the event
 *
 * @returns EventStats
 */
/**
 * @param live When true (the attendance screen), poll so a second device's
 *   scans appear without a manual refresh. Leave false (report pages) so
 *   completed events don't poll needlessly. `enabled: !!eventId` only means an
 *   id exists, not that attendance is active - hence the explicit flag.
 */
export const useStatsOfEvent = (eventId?: string, live = false) => {
  return useQuery({
    queryKey: queryKeys.events.statsFromEvent(eventId!),
    enabled: !!eventId,
    queryFn: () => {
      if (!eventId) return null;

      return fetchApi<EventStats>(`/api/events/${eventId}/stats`);
    },
    ...(live
      ? {
          staleTime: 5_000,
          refetchInterval: 8_000,
          refetchIntervalInBackground: false,
        }
      : {}),
  });
};

/**
 * Fetches all events
 */
const useEvents = (options: UseEventsOptions = {}) => {
  const { scope = "visible", status } = options;

  return useQuery({
    queryKey: queryKeys.events.list(scope, status),
    queryFn: async () => {
      const params = new URLSearchParams();

      if (scope) {
        params.set("scope", scope);
      }

      if (status) {
        params.set("status", status);
      }

      const query = params.toString();
      const endpoint = query ? `/api/events?${query}` : "/api/events";

      const events = await fetchApi<EventAPI[]>(endpoint);
      return events.map(transformEvent);
    },
  });
};

/**
 * Fetches all events
 */
export const useFetchApprovedEvents = () => {
  return useQuery({
    queryKey: queryKeys.events.allApproved(),
    queryFn: async () => {
      const events = await fetchApi<EventAPI[]>("/api/events?status=APPROVED");
      return events.map(transformEvent);
    },
  });
};

/**
 * Fetches an event through its id.
 *
 * @param live When true (the attendance screen), poll so event mode changes
 *   (isTimeout) made on another device are reflected here. Leave false
 *   elsewhere so it doesn't poll needlessly.
 * @param freshOnMount Force a fresh read when opening a duplicate form, even
 *   when the source is already cached by the calendar list.
 */
export const useFetchEvent = (eventId?: string, live = false, freshOnMount = false) => {
  return useQuery({
    queryKey: queryKeys.events.withId(eventId!),
    queryFn: async () => {
      const event = await fetchApi<EventAPI>(`/api/events/${eventId}`);
      return transformEvent(event);
    },
    enabled: !!eventId,
    refetchOnMount: freshOnMount ? "always" : true,
    ...(live
      ? {
          staleTime: 5_000,
          refetchInterval: 8_000,
          refetchIntervalInBackground: false,
        }
      : {}),
  });
};

export default useEvents;
