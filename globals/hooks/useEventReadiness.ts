import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/globals/contexts/AuthContext";
import type { EventReadiness } from "@/globals/types/eventReadiness";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";

export function useEventReadiness(eventId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.events.readiness(eventId ?? "", user?.id ?? ""),
    enabled: !!eventId && !!user,
    queryFn: ({ signal }) => fetchApi<EventReadiness>(
      `/api/events/${encodeURIComponent(eventId!)}/readiness`, { signal },
    ),
    staleTime: 15_000,
    refetchOnMount: "always",
    retry: false,
  });
}
