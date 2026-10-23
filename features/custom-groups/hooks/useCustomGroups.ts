"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { CustomGroup, CustomGroupDetail, StudentSearchResult } from "../types";

const customGroupKeys = {
  all: ["custom-groups"] as const,
  list: ["custom-groups", "list"] as const,
  detail: (groupId: string) => ["custom-groups", "detail", groupId] as const,
  students: (search: string) => ["custom-groups", "students", search] as const,
};

const groupUrl = (groupId: string) => `/api/custom-groups/${encodeURIComponent(groupId)}`;
const jsonBody = (method: string, values: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(values),
});

export const useCustomGroups = () => useQuery({
  queryKey: customGroupKeys.list,
  queryFn: ({ signal }) => fetchApi<CustomGroup[]>("/api/custom-groups", { signal }),
});

export const useCustomGroup = (groupId: string) => useQuery({
  queryKey: customGroupKeys.detail(groupId),
  queryFn: ({ signal }) => fetchApi<CustomGroupDetail>(groupUrl(groupId), { signal }),
});

export const useSearchGroupStudents = (search: string) => useQuery({
  queryKey: customGroupKeys.students(search),
  queryFn: ({ signal }) => fetchApi<StudentSearchResult[]>(
    `/api/custom-groups/students?search=${encodeURIComponent(search)}`, { signal },
  ),
  enabled: search.length > 0,
});

function useInvalidateCustomGroups() {
  const client = useQueryClient();
  // Membership is live eligibility: refresh roster/report consumers as well as
  // the management screens and the event audience pickers.
  return () => Promise.all([
    customGroupKeys.all,
    queryKeys.groups.all(),
    queryKeys.audience.all(),
    queryKeys.students.all(),
    queryKeys.events.all(),
    queryKeys.reports.all(),
    queryKeys.records.all(),
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function useSaveCustomGroup() {
  const invalidate = useInvalidateCustomGroups();
  return useMutation({
    mutationFn: ({ groupId, name }: { groupId?: string; name: string }) =>
      fetchApi<Omit<CustomGroup, "memberCount">>(groupId ? groupUrl(groupId) : "/api/custom-groups",
        jsonBody(groupId ? "PATCH" : "POST", { name })),
    onSuccess: invalidate,
  });
}

type MembershipChange =
  | { action: "add"; studentId: string; position: string | null }
  | { action: "position"; studentId: string; position: string | null }
  | { action: "remove"; studentId: string };

export function useChangeMembership(groupId: string) {
  const invalidate = useInvalidateCustomGroups();
  return useMutation({
    mutationFn: (change: MembershipChange) => {
      const base = `${groupUrl(groupId)}/members`;
      if (change.action === "add") {
        return fetchApi<unknown>(base, jsonBody("POST", {
          studentId: change.studentId, position: change.position,
        }));
      }
      const url = `${base}/${encodeURIComponent(change.studentId)}`;
      return fetchApi<unknown>(url, change.action === "remove"
        ? { method: "DELETE" }
        : jsonBody("PATCH", { position: change.position }));
    },
    onSuccess: invalidate,
  });
}
