"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import type {
  BackupJobDetail,
  BackupJobRecord,
  BackupStatusDTO,
} from "@/globals/types/backups";

/**
 * Canonical backup evidence. Polled only while the Backups panel is visible
 * (30s, no background polling); an explicit refresh coalesces with a current
 * request. Consumed by the Backups console and, via the same DTO, by #85.
 */
export const useBackupStatus = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.backups.status(),
    queryFn: () => fetchApi<BackupStatusDTO>("/api/admin/backups/status"),
    staleTime: 0,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
    enabled,
  });
};

export const useBackupJobs = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.backups.jobs(),
    queryFn: () => fetchApi<{ jobs: BackupJobRecord[] }>("/api/admin/backups/jobs?limit=20"),
    staleTime: 0,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
    enabled,
  });
};

export const useBackupJob = (jobId: string | null) => {
  return useQuery({
    queryKey: queryKeys.backups.job(jobId ?? "none"),
    queryFn: () => fetchApi<BackupJobDetail>(`/api/admin/backups/jobs/${jobId}`),
    enabled: !!jobId,
    staleTime: 0,
  });
};

export const useRequestBackup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchApi<{ job: BackupJobRecord; deduped: boolean }>("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all() });
    },
  });
};
