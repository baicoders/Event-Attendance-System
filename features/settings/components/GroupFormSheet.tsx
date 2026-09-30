"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/globals/components/shad-cn/sheet";
import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import FormSelect from "@/globals/components/shared/FormSelect";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import { slugify } from "@/globals/utils/text";
import {
  CreateGroupValues,
  GroupCategory,
  GROUP_CATEGORIES,
  createGroupSchema,
} from "@/globals/schemas/groupSchema";
import {
  ManagedGroup,
  useCreateGroup,
  useUpdateGroup,
} from "@/globals/hooks/useGroups";

const CATEGORY_OPTIONS = GROUP_CATEGORIES.map((category) => ({
  label: category,
  value: category,
}));

type Props = {
  isOpen: boolean;
  /** Present => rename an existing group. Absent => create a new one. */
  group?: ManagedGroup;
  onClose: () => void;
  createDefaults?: { slug: string; category: GroupCategory };
  onCreated?: () => void;
};

/**
 * Create or rename a group.
 *
 * On edit only the name is editable. The slug is what students are written
 * against and what the roster boards navigate by, so changing it is a delete
 * and recreate, not an edit.
 */
const GroupFormSheet = ({ isOpen, group, onClose, createDefaults, onCreated }: Props) => {
  const isEdit = !!group;
  const { mutateAsync: createGroup } = useCreateGroup();
  const { mutateAsync: updateGroup } = useUpdateGroup();

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<CreateGroupValues>({
    resolver: zodResolver(createGroupSchema),
    mode: "onChange",
    defaultValues: { name: "", slug: createDefaults?.slug ?? "", category: createDefaults?.category },
  });

  useEffect(() => {
    reset(
      group
        ? { name: group.name, slug: group.slug, category: group.category }
        : { name: "", slug: createDefaults?.slug ?? "", category: createDefaults?.category },
    );
  }, [group, reset, isOpen, createDefaults]);

  // Derive the slug from the name until the operator edits it themselves.
  // Existing data proves the two can legitimately diverge - the "Computer
  // System Servicing" strand is stored as `css` - so this only ever suggests.
  const name = watch("name");
  useEffect(() => {
    if (isEdit || createDefaults) return;
    if (getFieldState("slug").isDirty) return;
    setValue("slug", slugify(name ?? ""));
  }, [name, isEdit, createDefaults, getFieldState, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit) {
        await updateGroup({ groupId: group.id, name: values.name });
        toastSuccess("Group renamed", `Now shown as "${values.name}".`);
      } else {
        await createGroup(values);
        toastSuccess(
          "Group created",
          `"${values.name}" can now be used in imports and events.`,
        );
      }
      onClose();
      if (!isEdit) onCreated?.();
    } catch (error) {
      toastDanger(
        isEdit ? "Couldn't rename group" : "Couldn't create group",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col border-l-slate-200 bg-white p-0 sm:max-w-md">
        <form onSubmit={onSubmit} className="flex h-full flex-col" noValidate>
          <SheetHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
            <SheetTitle className="text-xl font-bold text-slate-800">
              {isEdit ? "Rename group" : "Add group"}
            </SheetTitle>
            <SheetDescription className="text-sm text-slate-500">
              {isEdit
                ? "The slug and category are fixed once a group exists."
                : "Groups are what a roster import and an event's audience are matched against."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <FormInput
              label="Name"
              placeholder="e.g. BSIT-3A"
              {...register("name")}
              error={errors.name?.message}
            />

            <FormInput
              label="Slug"
              placeholder="e.g. bsit-3a"
              disabled={isEdit}
              description={
                isEdit
                  ? "Fixed. Delete and recreate the group to change it."
                  : "The exact value a CSV column must contain. Lowercase, numbers, and hyphens."
              }
              {...register("slug")}
              error={errors.slug?.message}
            />

            {isEdit || createDefaults ? (
              // Read-only rather than a disabled select: PATCH only accepts a
              // name, so offering the control at all would be a lie.
              <div>
                <p className="ml-1 text-[10px] font-bold uppercase text-slate-400">
                  Category
                </p>
                <p className="mt-1.5 ml-1 text-sm text-slate-900">
                  {group?.category ?? createDefaults?.category}
                </p>
                <p className="mt-1 ml-1 text-[11px] text-slate-500">
                  {createDefaults ? "Fixed to the CSV column being resolved." : "Fixed once a group exists."}
                </p>
              </div>
            ) : (
              <FormSelect
                name="category"
                label="Category"
                placeholder="Choose a category"
                options={CATEGORY_OPTIONS}
                control={control}
                description="Which student column and which event audience this group belongs to."
                error={errors.category?.message}
              />
            )}
          </div>

          <SheetFooter className="flex flex-row items-center gap-2 border-t border-slate-100 bg-slate-50/50 p-6">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {isEdit ? "Save" : "Create"}
                </>
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default GroupFormSheet;
