"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import { toastSuccess } from "@/globals/components/shared/toasts";
import { useChangeMembership } from "../hooks/useCustomGroups";
import { studentName, type CustomGroupMember } from "../types";

export default function MemberPositionEditor({ member }: { member: CustomGroupMember }) {
  const inputId = useId();
  const [position, setPosition] = useState(member.position ?? "");
  const [error, setError] = useState<string>();
  const change = useChangeMembership(member.groupId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    setError(undefined);
    try {
      await change.mutateAsync({ action: "position", studentId: member.studentId, position: position.trim() || null });
      toastSuccess("Position saved", studentName(member.student));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save this position.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-64 space-y-2">
      <div className="flex items-end gap-2">
        <FormInput id={inputId} label="Position (optional)" aria-label={`Position for ${studentName(member.student)}`} value={position} maxLength={160} placeholder="No position" disabled={change.isPending} onChange={(event) => { setPosition(event.target.value); setError(undefined); }} />
        <Button type="submit" size="sm" variant="outline" disabled={change.isPending || position.trim() === (member.position ?? "")} aria-label={`Save position for ${studentName(member.student)}`}>
          {change.isPending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
      {error && <p role="alert" className="max-w-72 whitespace-normal text-xs text-rose-600">{error}</p>}
    </form>
  );
}
