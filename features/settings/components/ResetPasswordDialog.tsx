"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/globals/components/shad-cn/dialog";
import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import { Alert, AlertDescription } from "@/globals/components/shad-cn/alert";
import type { ManagedUser } from "@/globals/hooks/useAdmin";

type Props = {
  target: ManagedUser | null;
  adminPassword: string;
  onAdminPasswordChange: (value: string) => void;
  isResetting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Small reauth + revision form shown before the existing `useConfirm()`
 * primitive. Never displays a credential — the one-time value only appears in
 * `TempPasswordDialog` after commit.
 */
const ResetPasswordDialog = ({
  target,
  adminPassword,
  onAdminPasswordChange,
  isResetting,
  onCancel,
  onSubmit,
}: Props) => {
  const [touched, setTouched] = useState(false);

  if (!target) return null;

  const showError = touched && adminPassword.length === 0;
  const needsApprovalNote =
    target.status === "PENDING" || target.status === "REJECTED";

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (adminPassword.length === 0) return;
    onSubmit();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isResetting && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset {target.name}&apos;s password</DialogTitle>
          <DialogDescription>
            Target: {target.email} · {target.role} · {target.status}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <Alert>
            <AlertDescription>
              The old password and existing sign-ins will stop working. This
              does not approve an account or change its role.
              {needsApprovalNote
                ? " Login still requires account approval — resetting a pending or rejected account does not activate it."
                : null}
            </AlertDescription>
          </Alert>

          <FormInput
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={adminPassword}
            onChange={(event) => onAdminPasswordChange(event.target.value)}
            error={showError ? "Enter your current password to continue." : undefined}
            description="Confirms it is really you before the old password stops working."
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isResetting}>
              {isResetting ? "Resetting…" : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
