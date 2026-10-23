"use client";

import { Loader2, UserMinus } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { useChangeMembership } from "../hooks/useCustomGroups";
import { studentName, type CustomGroupMember } from "../types";

export default function RemoveGroupMember({ member }: { member: CustomGroupMember }) {
  const confirm = useConfirm();
  const change = useChangeMembership(member.groupId);
  async function onRemove() {
    if (!await confirm({ title: `Remove ${studentName(member.student)}?`, description: "This student will no longer be eligible through this group. Existing attendance records are preserved." })) return;
    try {
      await change.mutateAsync({ action: "remove", studentId: member.studentId });
      toastSuccess("Member removed", studentName(member.student));
    } catch (cause) {
      toastDanger("Couldn't remove member", cause instanceof Error ? cause.message : "Please retry.");
    }
  }
  return <Button type="button" variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" disabled={change.isPending} onClick={onRemove} aria-label={`Remove ${studentName(member.student)} from group`}>
    {change.isPending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <UserMinus aria-hidden className="size-3.5" />}Remove
  </Button>;
}
