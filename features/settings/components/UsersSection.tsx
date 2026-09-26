"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import DataTable from "@/globals/components/shared/dataTable/DataTable";
import {
  DataTableEmptyState,
  DataTableErrorState,
} from "@/globals/components/shared/dataTable/DataTableStates";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { type as typeToken } from "@/globals/constants/designTokens";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { ApiError } from "@/globals/utils/api";
import { queryKeys } from "@/globals/utils/queryKeys";
import {
  ManagedUser,
  TemporaryPasswordResult,
  resetUserPasswordApi,
  useUsers,
} from "@/globals/hooks/useAdmin";
import { getUserColumns } from "../constants/usersTable";
import ResetPasswordDialog from "./ResetPasswordDialog";
import TempPasswordDialog from "./TempPasswordDialog";

/**
 * The full user directory. Read-only apart from issuing a temporary password —
 * approving and rejecting pending organizers stays on the dashboard.
 */
const UsersSection = () => {
  const { data: users, isLoading, isError } = useUsers();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [target, setTarget] = useState<ManagedUser | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [issued, setIssued] = useState<TemporaryPasswordResult | null>(null);

  const rows = useMemo(() => users ?? [], [users]);
  const activeCount = rows.filter((user) => user.status === "ACTIVE").length;

  // An issuance is bound to its target: switching accounts, signing out, or a
  // revoked/restricted session hides the value instead of showing it against
  // the wrong row.
  useEffect(() => {
    const onInvalid = () => {
      setIssued(null);
      setTarget(null);
      setAdminPassword("");
    };
    window.addEventListener("auth:session-invalid", onInvalid);
    return () => window.removeEventListener("auth:session-invalid", onInvalid);
  }, []);

  // While a reset is pending or an issuance awaits dismissal, no competing
  // reset may start — a second reset would silently replace the undelivered
  // credential.
  const busy = isResetting || issued !== null || target !== null;
  const processingId = isResetting ? target?.id ?? null : null;

  const openReset = (user: ManagedUser) => {
    if (busy) return;
    setIssued(null);
    setAdminPassword("");
    // Snapshot the reviewed revision at open; the confirmed request sends it
    // back as its precondition.
    setTarget(user);
  };

  const closeReset = () => {
    if (isResetting) return;
    setTarget(null);
    setAdminPassword("");
  };

  const handleConfirmReset = async () => {
    if (!target || adminPassword.length === 0 || isResetting) return;

    // The password field lives in the small form above; the existing
    // confirmation primitive takes the final consequential decision without
    // ever carrying a credential in its description.
    const confirmed = await confirm({
      title: `Reset ${target.name}'s password?`,
      description:
        "Their current password stops working immediately. You will be shown a temporary password to give them, once.",
    });
    if (!confirmed) return;

    const { id, name, credentialVersion } = target;
    setIsResetting(true);
    try {
      const result = await resetUserPasswordApi(id, {
        adminPassword,
        expectedCredentialVersion: credentialVersion,
      });
      setIssued(result);
      setTarget(null);
      setAdminPassword("");
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() });
      toastSuccess("Password reset", `${name} needs the new password.`);
    } catch (error) {
      // Always discard what was typed; never toast a credential.
      setAdminPassword("");
      if (error instanceof ApiError && error.code === "USE_CHANGE_PASSWORD") {
        setTarget(null);
        toastDanger(
          "Use Change password",
          "Use the Change password form for your own account instead.",
        );
        return;
      }
      if (error instanceof ApiError && error.code === "CREDENTIALS_CHANGED") {
        setTarget(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() });
        toastDanger(
          "User changed",
          "Reload the directory and confirm again with a fresh review.",
        );
        return;
      }
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        // Wrong admin password: preserve the target/context, ask again.
        toastDanger("Couldn't reset password", error.message || undefined);
        return;
      }
      if (error instanceof ApiError) {
        // Typed rejection (validation, rate limit, forbidden): keep the
        // target so a deliberate retry is possible, but require a fresh
        // password entry and another confirmation.
        toastDanger(
          "Couldn't reset password",
          error.message || undefined,
        );
        return;
      }
      // The response was lost: the plaintext cannot be recovered and the
      // target must not be labelled unchanged. A new, explicitly confirmed
      // reset is the recovery action.
      toastDanger(
        "Outcome unknown",
        "The outcome could not be confirmed. If the user cannot sign in with either password, confirm a new reset.",
      );
    } finally {
      setIsResetting(false);
    }
  };

  const columns = useMemo(
    () =>
      getUserColumns({
        onResetPassword: openReset,
        processingId,
        resetDisabled: busy,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [processingId, busy],
  );

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className={typeToken.sectionTitle}>Users</h2>
          <p className={typeToken.muted}>
            Everyone with an account. Approvals and rejections happen on the
            dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge>Total: {rows.length}</StatusBadge>
          <StatusBadge tone="success">Active: {activeCount}</StatusBadge>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        getRowId={(row) => row.id}
        showToolbar
        errorState={
          <DataTableErrorState
            title="Couldn't load users"
            description="Please retry."
          />
        }
        emptyState={<DataTableEmptyState title="No users yet" />}
      />

      <ResetPasswordDialog
        target={target}
        adminPassword={adminPassword}
        onAdminPasswordChange={setAdminPassword}
        isResetting={isResetting}
        onCancel={closeReset}
        onSubmit={handleConfirmReset}
      />

      <TempPasswordDialog result={issued} onClose={() => setIssued(null)} />
    </section>
  );
};

export default UsersSection;
