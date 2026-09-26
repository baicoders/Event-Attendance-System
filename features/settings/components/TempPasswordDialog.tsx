"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/globals/components/shad-cn/dialog";
import { Button } from "@/globals/components/shad-cn/button";
import { Alert, AlertDescription } from "@/globals/components/shad-cn/alert";
import { toastDanger } from "@/globals/components/shared/toasts";
import type { TemporaryPasswordResult } from "@/globals/hooks/useAdmin";

type Props = {
  result: TemporaryPasswordResult | null;
  onClose: () => void;
};

/** Shows a freshly issued temporary password. It is not retrievable again. */
const TempPasswordDialog = ({ result, onClose }: Props) => {
  const [hasCopied, setHasCopied] = useState(false);
  const issuance = result?.temporaryPassword;

  // Reset the copied indicator per issuance — a reopened dialog must never
  // show a stale "copied" state from a previous credential.
  useEffect(() => {
    setHasCopied(false);
  }, [issuance]);

  if (!result) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setHasCopied(true);
    } catch {
      // Clipboard access is blocked over plain HTTP on some browsers, which is
      // exactly how this app is deployed - say so instead of failing silently.
      toastDanger(
        "Couldn't copy",
        "Copy the password manually from the box above.",
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password for {result.name}</DialogTitle>
          <DialogDescription>
            {result.email} — give this directly to the verified account holder.
            Only password replacement is allowed until they choose their own.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-lg tracking-wider break-all text-slate-900 select-all">
            {result.temporaryPassword}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Copy temporary password"
            onClick={handleCopy}
          >
            {hasCopied ? (
              <Check className="size-4 text-emerald-600" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>

        <Alert>
          <AlertDescription>
            This is the only time it is shown. Closing this panel hides the
            value. A new reset replaces it — if it is lost, reset again with a
            fresh confirmation.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TempPasswordDialog;
