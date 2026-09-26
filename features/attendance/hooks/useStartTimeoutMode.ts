import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/globals/utils/queryKeys";
import { fetchApi } from "@/globals/utils/api";
import { Event } from "@/globals/types/events";

/**
 * Sets the event's timeout mode to an explicit desired state (not a blind
 * toggle), so concurrent requests from two devices converge instead of
 * cancelling out. Resolves with the updated event.
 */
const useToggleTimeoutMode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, isTimeout }: { eventId: string; isTimeout: boolean }) => {
      return fetchApi<Event>(`/api/events/${eventId}/timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTimeout }),
      });
    },
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.withId(eventId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
    },
  });
};

export default useToggleTimeoutMode;
