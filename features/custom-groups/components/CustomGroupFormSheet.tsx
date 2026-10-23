"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import FormInput from "@/globals/components/shared/FormInput";
import { toastSuccess } from "@/globals/components/shared/toasts";
import { useSaveCustomGroup } from "../hooks/useCustomGroups";
import type { CustomGroup } from "../types";

type Props = {
  group?: CustomGroup;
  onClose: () => void;
  onCreated?: (group: Omit<CustomGroup, "memberCount">) => void;
};

export default function CustomGroupFormSheet({ group, onClose, onCreated }: Props) {
  const [name, setName] = useState(group?.name ?? "");
  const [error, setError] = useState<string>();
  const save = useSaveCustomGroup();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    if (!name.trim()) {
      setError("Enter a group name.");
      return;
    }
    setError(undefined);
    try {
      const result = await save.mutateAsync({ groupId: group?.id, name: name.trim() });
      toastSuccess(group ? "Group renamed" : "Custom group created");
      onClose();
      if (!group) onCreated?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save this group. Please retry.");
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent className="flex w-full flex-col border-l-slate-200 bg-white p-0 sm:max-w-md" showCloseButton={!save.isPending}>
        <form onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
            <SheetTitle>{group ? "Rename custom group" : "Create custom group"}</SheetTitle>
            <SheetDescription>Name a club, organization, team, or other student group.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <FormInput label="Group name" name="name" value={name} onChange={(event) => { setName(event.target.value); setError(undefined); }} placeholder="e.g. USWAG" maxLength={80} required autoFocus disabled={save.isPending} />
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          </div>
          <SheetFooter className="flex-row border-t border-slate-100 bg-slate-50/50 p-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={save.isPending || !name.trim()} className="flex-1">
              {save.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
              {save.isPending ? "Saving…" : group ? "Save name" : "Create group"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
