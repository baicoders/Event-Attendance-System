import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Record, CreateRecordInput, RecordWireResult } from "@/globals/types/records";
import { StudentAttendanceRecord } from "@/globals/types/students";
import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";

/**
 * Creates a new attendance record.
 *
 * Uses optimistic updates to immediately reflect the new record in the UI
 * before the server confirms the change.
 */
export const useCreateRecord = (_eventId: string) => {
  void _eventId;
  const queryClient = useQueryClient();

  return useMutation({
    // `changed` is false when the scan was a no-op (already timed in/out), so
    // the caller can avoid falsely reporting a fresh record.
    mutationFn: (record: CreateRecordInput) => {
      return fetchApi<RecordWireResult>("/api/records", {
        method: "POST",
        body: JSON.stringify(record),
        headers: { "Content-Type": "application/json" },
      });
    },

    // No optimistic write here: the attendance-records cache holds enriched
    // StudentAttendanceRecord rows (fullName/schoolLevel/section) which this
    // mutation's input can't reconstruct - appending a raw record corrupted
    // the row and duplicated it in timeout mode. The success invalidation
    // below refetches immediately, and the live table also polls.

    /** Re-sync server state after success */
    onSuccess: (data, input) => {
      const eventId = input.eventId;
      // Prefix invalidation so BOTH the live present-only table and the
      // includeAbsent report variant refresh (not just the exact false key).
      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventPrefix(eventId),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventForStudent(eventId, data.studentId),
        exact: true,
      });

      // Dashboard/report numbers depend on records - keep them fresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.statsFromEvent(eventId),
        exact: true,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.events.progressPrefix(eventId) });
    },
    retry: false,
  });
};

/**
 * Records the "present" action on an existing record (time-in or time-out
 * depending on the event's mode).
 */
export const useUpdateAttendanceRecord = (eventId: string) => {
  void eventId;
  const queryClient = useQueryClient();

  return useMutation({
    // `changed` is false when the request was a no-op (already timed in/out),
    // so the caller can avoid falsely reporting an update.
    mutationFn: (recordId: string) => {
      return fetchApi<Record & { changed: boolean }>(
        `/api/records/${recordId}`,
        {
          method: "PATCH",
        },
      );
    },

    // No optimistic write: whether this sets a time-in, a time-out, or nothing
    // depends on the event's server-side mode, and the cache holds enriched
    // StudentAttendanceRecord rows this mutation's input can't reconstruct.
    // The success invalidation below refetches; the live table also polls.

    /** Re-sync server state after success */
    onSuccess: (data) => {
      const affectedEventId = data.eventId;
      // Prefix invalidation so BOTH the live present-only table and the
      // includeAbsent report variant refresh (not just the exact false key).
      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventPrefix(affectedEventId),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventForStudent(affectedEventId, data.studentId),
        exact: true,
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.events.statsFromEvent(affectedEventId),
        exact: true,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.events.progressPrefix(affectedEventId) });
    },
  });
};

/**
 * Deletes a single attendance record.
 *
 * Uses optimistic removal so the row disappears instantly.
 */
export const useDeleteRecord = (eventId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      return fetchApi<Record>(`/api/records/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
    },

    onMutate: async (recordId) => {
      const key = queryKeys.records.fromEvent(eventId);

      await queryClient.cancelQueries({ queryKey: key });

      const previousRecords =
        queryClient.getQueryData<StudentAttendanceRecord[]>(key);

      // Optimistically remove record from cache
      if (previousRecords) {
        queryClient.setQueryData(
          key,
          previousRecords.filter((record) => record.id !== recordId),
        );
      }

      return { previousRecords };
    },

    onError: (_err, _vars, context) => {
      const key = queryKeys.records.fromEvent(eventId);
      if (context?.previousRecords) {
        queryClient.setQueryData(key, context.previousRecords);
      }
    },

    onSuccess: (data) => {
      const affectedEventId = data.eventId;
      // Prefix invalidation so BOTH the live present-only table and the
      // includeAbsent report variant refresh (not just the exact false key).
      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventPrefix(affectedEventId),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.records.fromEventForStudent(affectedEventId, data.studentId),
        exact: true,
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.events.statsFromEvent(affectedEventId),
        exact: true,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.events.progressPrefix(affectedEventId) });
    },
  });
};

/**
 * Fetches all attendance records for an event.
 */
/**
 * @param live When true (the attendance screen), poll so scans from another
 *   device appear without a manual refresh. staleTime marks data eligible for
 *   refetch but doesn't trigger one; with focus refetch off, only this interval
 *   keeps a passive device fresh. Leave false (report pages) so completed
 *   events don't poll - `enabled: !!eventId` only means an id exists.
 */
export const useAllRecordsFromEvent = (
  eventId?: string,
  { live = false, includeAbsent = false, onlyNeedsReview = false }: { live?: boolean; includeAbsent?: boolean; onlyNeedsReview?: boolean } = {},
) => {
  return useQuery({
    queryKey: queryKeys.records.fromEvent(eventId!, includeAbsent, onlyNeedsReview),
    enabled: !!eventId,
    queryFn: async () => {
      if (!eventId) return null;

      const suffix = includeAbsent ? "?includeAbsent=true" : onlyNeedsReview ? "?onlyNeedsReview=true" : "";
      return fetchApi<StudentAttendanceRecord[]>(
        `/api/events/${eventId}/records${suffix}`,
      );
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
 * Fetches the attendance record of a specific student in a specific event.
 *
 * Returns null when no record exists.
 */
export const useRecordOfStudentInEvent = (
  eventId?: string,
  studentId?: string,
  { live = false, active = true }: { live?: boolean; active?: boolean } = {},
) => {
  return useQuery({
    queryKey: queryKeys.records.fromEventForStudent(eventId!, studentId!),
    enabled: !!eventId && !!studentId && active,
    queryFn: async ({ signal }) => {
      if (!eventId || !studentId) return null;
      const params = new URLSearchParams({ eventId, studentId });
      return fetchApi<Record>(`/api/records?${params}`, { signal });
    },
    ...(live ? { staleTime: 5_000, refetchInterval: 8_000, refetchIntervalInBackground: false } : {}),
  });
};
