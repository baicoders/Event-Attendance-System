"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import { useAuth } from "@/globals/contexts/AuthContext";
import type { CorrectionCommand, CorrectionReceipt, HistoryPage, ReviewPage } from "../types/corrections";

export function useAttendanceReview(eventId: string, params: URLSearchParams) {
  const { user } = useAuth();
  const serialized = params.toString();
  return useQuery({ queryKey: queryKeys.attendance.review(eventId, user?.id ?? "", serialized), enabled: !!eventId && !!user?.id,
    queryFn: ({ signal }) => fetchApi<ReviewPage>(`/api/events/${encodeURIComponent(eventId)}/attendance-review?${serialized}`, { signal }) });
}

export function useAttendanceHistory(eventId: string, studentId: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: queryKeys.attendance.history(eventId, studentId ?? "", user?.id ?? ""), enabled: !!eventId && !!studentId && !!user?.id,
    queryFn: ({ signal }) => fetchApi<HistoryPage>(`/api/events/${encodeURIComponent(eventId)}/attendance-history?studentId=${encodeURIComponent(studentId!)}`, { signal }) });
}

export function useAttendanceCorrection(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: CorrectionCommand) => fetchApi<CorrectionReceipt>(`/api/events/${encodeURIComponent(eventId)}/attendance-corrections`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
    }),
    onSuccess: (receipt) => {
      const { eventId: changedEvent, studentId } = receipt;
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.attendance.reviewPrefix(changedEvent) }),
        client.invalidateQueries({ queryKey: queryKeys.attendance.historyPrefix(changedEvent, studentId) }),
        client.invalidateQueries({ queryKey: queryKeys.records.fromEventPrefix(changedEvent) }),
        client.invalidateQueries({ queryKey: queryKeys.records.fromEventForStudent(changedEvent, studentId), exact: true }),
        client.invalidateQueries({ queryKey: queryKeys.records.fromStudent(studentId) }),
        client.invalidateQueries({ queryKey: queryKeys.events.statsFromEvent(changedEvent), exact: true }),
        client.invalidateQueries({ queryKey: queryKeys.events.progressPrefix(changedEvent) }),
        client.invalidateQueries({ queryKey: queryKeys.reports.all() }),
      ]);
    },
    retry: false,
  });
}
