"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/globals/contexts/AuthContext";
import { fetchApi, ApiError } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { StudentHistoryResponse } from "@/globals/types/studentHistory";

export function useStudentAttendanceHistory(studentId: string, params: URLSearchParams, enabled = true) {
  const { user } = useAuth();
  const client = useQueryClient();
  const queryString = params.toString();
  const principalId = user?.id ?? "";
  const query = useQuery({
    queryKey: queryKeys.reports.studentHistory(principalId, studentId, queryString),
    enabled: enabled && !!studentId && !!principalId && user?.status === "ACTIVE",
    queryFn: ({ signal }) => fetchApi<StudentHistoryResponse>(
      `/api/students/${encodeURIComponent(studentId)}/attendance-history?${queryString}`,
      { signal, cache: "no-store" }),
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) && count < 2,
  });
  useEffect(() => {
    if (!user || user.status !== "ACTIVE" ||
        (query.error instanceof ApiError && [401, 403].includes(query.error.status))) {
      void client.cancelQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
      client.removeQueries({ queryKey: queryKeys.reports.studentHistoryPrefix() });
    } else {
      client.removeQueries({ queryKey: queryKeys.reports.studentHistoryPrefix(),
        predicate: item => item.queryKey[2] !== user.id });
    }
  }, [client, user, query.error]);
  return query;
}
