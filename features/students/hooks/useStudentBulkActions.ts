"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { BulkAction } from "@/globals/schemas/studentBulk";
import type {
  BulkCommitResponse,
  BulkExportResponse,
  BulkPreviewResponse,
} from "@/globals/types/studentBulk";

export class BulkApiError extends ApiError {
  issues: Array<{ id: string; reason: string; reasonCode: string }>;
  missingIds: string[];
  constructor(
    message: string,
    status: number,
    code?: string,
    issues?: Array<{ id: string; reason: string; reasonCode: string }>,
    missingIds?: string[],
  ) {
    super(message, status, code);
    this.name = "BulkApiError";
    this.issues = issues ?? [];
    this.missingIds = missingIds ?? [];
  }
}

async function bulkFetch<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new BulkApiError("Invalid server response", res.status);
  }
  const envelope = json as {
    success: boolean;
    data?: T;
    message?: string;
    code?: string;
    issues?: Array<{ id: string; reason: string; reasonCode: string }>;
    missingIds?: string[];
  };
  if (!res.ok || !envelope || envelope.success !== true) {
    throw new BulkApiError(
      envelope?.message ?? res.statusText ?? "Request failed",
      res.status,
      envelope?.code,
      envelope?.issues,
      envelope?.missingIds,
    );
  }
  return (envelope as { success: true; data: T }).data;
}

export type BulkPreviewArgs = {
  studentIds: string[];
  action: BulkAction;
  targetGroupId: string;
  signal?: AbortSignal;
};

export type BulkCommitArgs = {
  previewToken: string;
  acknowledgeReportImpact: true;
};

export type BulkExportArgs = {
  studentIds: string[];
  signal?: AbortSignal;
};

function useInvalidateBulkDependents() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.students.all() });
    queryClient.invalidateQueries({ queryKey: ["stats", "students"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.records.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.groups.all() });
    // Student History is not a hard prerequisite for bulk (STUDENT-BULK is
    // releasable without it). Invalidate its prefix by literal so this hook
    // works whether or not that workstream has landed; a missing key is a
    // harmless no-op.
    queryClient.invalidateQueries({ queryKey: ["reports", "studentHistory"] });
  };
}

export function useBulkPreview() {
  return useMutation({
    mutationFn: ({ studentIds, action, targetGroupId, signal }: BulkPreviewArgs) =>
      bulkFetch<BulkPreviewResponse>("/api/students/bulk/preview", { studentIds, action, targetGroupId }, signal),
  });
}

export function useBulkCommit() {
  const invalidate = useInvalidateBulkDependents();
  return useMutation({
    mutationFn: ({ previewToken, acknowledgeReportImpact }: BulkCommitArgs) =>
      bulkFetch<BulkCommitResponse>("/api/students/bulk/commit", {
        previewToken,
        acknowledgeReportImpact,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useBulkExportSelected() {
  return useMutation({
    mutationFn: ({ studentIds, signal }: BulkExportArgs) =>
      bulkFetch<BulkExportResponse>("/api/students/export-selected", { studentIds }, signal),
  });
}
