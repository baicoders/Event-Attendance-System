"use client";

import { useEffect, useRef, useState } from "react";
import { useCreateRecord } from "@/globals/hooks/useRecords";
import { fetchApi } from "@/globals/utils/api";
import { fullName } from "@/globals/utils/formatting";
import { Student } from "@/globals/types/students";
import {
  createOperationCoordinator, OperationContext, OperationRequest, OperationState,
} from "@/features/attendance/utils/operationCoordinator";

export function useAttendanceOperation(context: OperationContext | null) {
  const { mutateAsync } = useCreateRecord(context?.eventId ?? "");
  const saveRef = useRef(mutateAsync);
  saveRef.current = mutateAsync;
  const [state, setState] = useState<OperationState>({ phase: "IDLE", lastResult: null, recent: [] });
  const coordinatorRef = useRef<ReturnType<typeof createOperationCoordinator> | null>(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createOperationCoordinator({
      lookup: async (eventId, studentId, signal) => {
        const params = new URLSearchParams({ eventId, studentId });
        const student = await fetchApi<Student>(`/api/students?${params}`, { signal });
        return { id: student.id, name: fullName(student.firstName, student.middleName ?? "", student.lastName) };
      },
      save: (input) => saveRef.current(input),
      onChange: setState,
    });
  }

  const eventId = context?.eventId;
  const viewerId = context?.viewerId;
  const expectedMode = context?.expectedMode;
  useEffect(() => {
    coordinatorRef.current?.setContext(eventId && viewerId && expectedMode ? { eventId, viewerId, expectedMode } : null);
  }, [eventId, viewerId, expectedMode]);
  useEffect(() => () => coordinatorRef.current?.dispose(), []);

  return {
    state,
    submit: (request: OperationRequest) => coordinatorRef.current!.submit(request),
    acknowledge: () => coordinatorRef.current!.acknowledge(),
  };
}
