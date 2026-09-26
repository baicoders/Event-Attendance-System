import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchApi } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";

export type PendingOrganizer = {
  id: string;
  name: string;
  email: string;
  status: "PENDING" | "ACTIVE" | "REJECTED";
  rejectionReason: string | null;
  createdAt: string;
};

export const usePendingOrganizers = () => {
  return useQuery({
    queryKey: queryKeys.admin.pendingOrganizers(),
    queryFn: () => fetchApi<PendingOrganizer[]>("/api/admin/organizers"),
  });
};

const useOrganizerDecision = (action: "APPROVE" | "REJECT") => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; reason?: string }) => {
      return fetchApi(`/api/admin/organizers/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: args.reason }),
      });
    },
    onSuccess: () => {
      // The whole `["admin"]` prefix: a decision moves the user out of the
      // pending queue AND changes their row in the console's user directory.
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() });
    },
  });
};

export const useApproveOrganizer = () => useOrganizerDecision("APPROVE");
export const useRejectOrganizer = () => useOrganizerDecision("REJECT");

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ORGANIZER";
  status: "PENDING" | "ACTIVE" | "REJECTED";
  rejectionReason: string | null;
  mustChangePassword: boolean;
  /** Reviewed revision the reset dialog sends as its precondition. */
  credentialVersion: number;
  createdAt: string;
};

/** Every user, for the operator console's directory. Admin only server-side. */
export const useUsers = () => {
  return useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => fetchApi<ManagedUser[]>("/api/admin/users"),
  });
};

export type TemporaryPasswordResult = {
  id: string;
  name: string;
  email: string;
  /** Shown once and never retrievable again. */
  temporaryPassword: string;
  /** The committed generation the new cookie (target's next sign-in) carries. */
  credentialVersion: number;
};

export type ResetPasswordArgs = {
  /** The acting admin's current password (reauth, never logged or toasted). */
  adminPassword: string;
  /** Target revision reviewed in the directory before confirmation. */
  expectedCredentialVersion: number;
};

/**
 * Imperative reset request — deliberately NOT a `useMutation`. A shared
 * mutation cache would retain the one-time secret and both password arguments
 * in history; callers hold busy/result in component-local state instead and
 * clear the displayed value on close, target change, or auth failure.
 */
export async function resetUserPasswordApi(
  userId: string,
  args: ResetPasswordArgs,
): Promise<TemporaryPasswordResult> {
  return fetchApi<TemporaryPasswordResult>(
    `/api/admin/users/${userId}/password`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    },
  );
}

export type SystemInfo = {
  nodeEnv: string;
  database: { database: string; serverVersion: string };
  authSecret: {
    configured: boolean;
    meetsMinLength: boolean;
    usingDevFallback: boolean;
  };
  appVersion: string;
  serverTime: string;
  counts: {
    students: number;
    groups: number;
    events: number;
    records: number;
    users: number;
  };
};

export const useSystemInfo = () => {
  return useQuery({
    queryKey: queryKeys.admin.system(),
    queryFn: () => fetchApi<SystemInfo>("/api/admin/system"),
    // serverTime is only useful if it is actually current.
    staleTime: 0,
  });
};
