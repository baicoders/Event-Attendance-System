"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/globals/contexts/AuthContext";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { StudentFormValues } from "@/globals/schemas/studentSchema";
import type { StudentDetail, StudentDetailDTO } from "@/globals/types/students";

const transform = (data: StudentDetailDTO): StudentDetail => ({
  ...data, createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt),
});

export function useStudentDetail(studentId: string) {
  const { user } = useAuth();
  const client = useQueryClient();
  const principalId = user?.id ?? "";
  const query = useQuery({
    queryKey: queryKeys.students.detail(principalId, studentId),
    enabled: !!studentId && !!principalId && user?.status === "ACTIVE",
    queryFn: async ({ signal }) => transform(await fetchApi<StudentDetailDTO>(
      `/api/students/${encodeURIComponent(studentId)}`, { signal, cache: "no-store" })),
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
  });
  useEffect(() => {
    if (!user || user.status !== "ACTIVE" ||
        (query.error instanceof ApiError && [401, 403].includes(query.error.status))) {
      void client.cancelQueries({ queryKey: ["students", "detail"] });
      client.removeQueries({ queryKey: ["students", "detail"] });
    } else {
      client.removeQueries({ queryKey: ["students", "detail"], predicate: item => item.queryKey[2] !== user.id });
    }
  }, [client, user, query.error]);
  return query;
}

export function useEditStudentDetail(studentId: string) {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ expectedVersion, student }: { expectedVersion: string; student: StudentFormValues }) =>
      transform(await fetchApi<StudentDetailDTO>(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ expectedVersion, student: { ...student, id: studentId } }),
      })),
    onSuccess: saved => {
      client.setQueryData(queryKeys.students.detail(user?.id ?? "", studentId), saved);
      void client.invalidateQueries({ queryKey: queryKeys.students.all() });
      void client.invalidateQueries({ queryKey: ["stats", "students"] });
      void client.invalidateQueries({ queryKey: queryKeys.audience.all() });
      void client.invalidateQueries({ queryKey: queryKeys.events.all() });
      void client.invalidateQueries({ queryKey: queryKeys.records.all() });
      void client.invalidateQueries({ queryKey: queryKeys.reports.all() });
    },
  });
}
