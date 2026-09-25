import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "../utils/api";
import { EventCategory } from "@prisma/client";
import { Option } from "../types/primitives";
import { queryKeys } from "../utils/queryKeys";
import {
  CreateGroupValues,
  GroupCategory,
  UpdateGroupValues,
} from "../schemas/groupSchema";

/** One row of `GET /api/groups/byCategory/[category]`. */
export type GroupChoice = {
  id: string;
  name: string;
  slug: string;
};

export type GroupReferencingEvent = {
  id: string;
  title: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
};

/** One row of the operator console's group table. */
export type ManagedGroup = {
  id: string;
  name: string;
  slug: string;
  // Narrower than EventCategory: ALL/COLLEGE/SHS are event-only and can never
  // appear on a group.
  category: GroupCategory;
  studentCount: number;
  eventCount: number;
  /** Events targeting this group; all of them block deletion. */
  events: GroupReferencingEvent[];
};

export const useFetchGroupsByCategory = (eventCategory?: EventCategory) => {
  return useQuery({
    queryKey: queryKeys.groups.byCategory(eventCategory ?? ""),
    enabled: !!eventCategory,
    queryFn: () => {
      return fetchApi<GroupChoice[]>(`/api/groups/byCategory/${eventCategory}`);
    },
    staleTime: 1000 * 60 * 5,
  });
};

export const useFetchGroups = () => {
  return useQuery({
    queryKey: queryKeys.groups.options(),
    queryFn: () => {
      // The route also returns synthesized SCHOOL_LEVEL / YEAR_LEVEL keys
      // alongside the real group categories.
      return fetchApi<Record<string, Option[]>>("/api/groups");
    },
    staleTime: 1000 * 60 * 5,
  });
};

export const useManageGroups = () => {
  return useQuery({
    queryKey: queryKeys.groups.manage(),
    queryFn: () => fetchApi<ManagedGroup[]>("/api/groups/manage"),
  });
};

/**
 * Every group mutation invalidates the whole `["groups"]` prefix. The pickers
 * cache for five minutes, so without this a group created to unblock an import
 * would not show up in the student form or the event drawer in time.
 */
const useInvalidateGroups = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.groups.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.audience.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.events.readinessAll() });
  };
};

export const useCreateGroup = () => {
  const invalidateGroups = useInvalidateGroups();

  return useMutation({
    mutationFn: (values: CreateGroupValues) =>
      fetchApi<ManagedGroup>("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: invalidateGroups,
  });
};

export const useUpdateGroup = () => {
  const invalidateGroups = useInvalidateGroups();

  return useMutation({
    mutationFn: ({
      groupId,
      ...values
    }: UpdateGroupValues & { groupId: string }) =>
      fetchApi<ManagedGroup>(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: invalidateGroups,
  });
};

export const useDeleteGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      groupId,
      reassignToGroupId = null,
    }: {
      groupId: string;
      reassignToGroupId?: string | null;
    }) =>
      fetchApi<{
        id: string;
        reassignedStudents: number;
        unassignedStudents: number;
      }>(`/api/groups/${groupId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reassignToGroupId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.audience.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.events.readinessAll() });
      // Deleting a group rewrites its students' memberships either way.
      queryClient.invalidateQueries({ queryKey: queryKeys.students.all() });
    },
  });
};
