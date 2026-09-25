import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { ProgressQuery } from "@/globals/utils/attendanceProgressQuery";
import { progressRequestParams } from "../utils/progressRequest";
import { validateProgressResponse } from "../utils/validateProgressResponse";

export function useAttendanceProgress(eventId: string | null, viewerId: string | undefined, query: ProgressQuery) {
  const serialized = progressRequestParams(query);
  return useQuery({
    queryKey: queryKeys.events.progress(eventId ?? "", viewerId ?? "", serialized),
    enabled: !!eventId && !!viewerId,
    queryFn: async ({ signal }) => validateProgressResponse(await fetchApi<unknown>(
      `/api/events/${encodeURIComponent(eventId!)}/progress?${serialized}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) },
    )),
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1,
  });
}
