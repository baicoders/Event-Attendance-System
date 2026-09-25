"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { format } from "date-fns";
import type { Event } from "@/globals/types/events";
import { eventSchema } from "@/globals/schemas";
import { formatEventPayload } from "@/globals/utils/events";
import { copyEventDefaults, isDuplicateRangeWhollyPast, isUnknownCreateOutcome, makeDuplicatePayload, type DuplicateDefaults } from "@/features/calendar/utils/duplicateEvent";
import { useFetchEvent, useSaveEvent } from "@/globals/hooks/useEvents";
import { useFetchGroupsByCategory } from "@/globals/hooks/useGroups";
import { EVENT_CHOICES } from "@/features/calendar/constants/categoryGroups";
import { toastSuccess } from "@/globals/components/shared/toasts";
import { Button } from "@/globals/components/shad-cn/button";
import { Label } from "@/globals/components/shad-cn/label";
import { Switch } from "@/globals/components/shad-cn/switch";
import { Textarea } from "@/globals/components/shad-cn/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import FormInput from "@/globals/components/shared/FormInput";
import ComboBox from "@/globals/components/shared/ComboBox";
import CheckboxGroup from "@/globals/components/shared/CheckboxGroup";
import DateTimeForm from "./DateTimeForm";

type DuplicateForm = DuplicateDefaults & { start?: Date; end?: Date };

type Props = {
  sourceId: string;
  onClose: () => void;
  onCreated: (event: Event) => void;
};

export default function DuplicateEventSheet({ sourceId, onClose, onCreated }: Props) {
  const sourceQuery = useFetchEvent(sourceId, false, true);
  const { mutateAsync: saveEvent, isPending } = useSaveEvent();
  const submitting = useRef(false);
  const [loadedSource, setLoadedSource] = useState<Event | null>(null);
  useEffect(() => {
    if (!loadedSource && sourceQuery.isSuccess && sourceQuery.isFetchedAfterMount) {
      setLoadedSource(sourceQuery.data);
    }
  }, [loadedSource, sourceQuery.isSuccess, sourceQuery.isFetchedAfterMount, sourceQuery.data]);

  const requestClose = () => {
    if (!submitting.current && !isPending) onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent showCloseButton={!isPending} className="h-svh w-full min-w-0 gap-0 overflow-hidden border-l-slate-200 bg-white p-0 sm:max-w-2xl">
        {!loadedSource && sourceQuery.isFetching ? (
          <div className="p-6 text-sm text-slate-600" role="status">
            <SheetTitle className="mb-3 text-xl">Duplicate event</SheetTitle>
            Loading event details…
          </div>
        ) : !loadedSource ? (
          <div className="space-y-4 p-6" role="alert">
            <SheetTitle>Duplicate event</SheetTitle>
            <p>Could not load this event. It may have been removed or you may no longer have access.</p>
            <Button type="button" onClick={() => sourceQuery.refetch()}>Retry</Button>
          </div>
        ) : (
          <DuplicateFormContent
            key={loadedSource.id}
            source={loadedSource}
            onClose={requestClose}
            onCreated={onCreated}
            saveEvent={saveEvent}
            isPending={isPending}
            submitting={submitting}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DuplicateFormContent({ source, onClose, onCreated, saveEvent, isPending, submitting }: {
  source: Event;
  onClose: () => void;
  onCreated: (event: Event) => void;
  saveEvent: ReturnType<typeof useSaveEvent>["mutateAsync"];
  isPending: boolean;
  submitting: React.RefObject<boolean>;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<DuplicateForm>({
    defaultValues: { ...copyEventDefaults(source), start: undefined, end: undefined },
  });
  const { control, register, handleSubmit, setValue, setError, watch, formState: { errors } } = form;
  const category = watch("category");
  const allDay = watch("allDay");
  const selectedGroups = watch("includedGroups");
  const showGroups = !["ALL", "COLLEGE", "SHS"].includes(category);
  const { data: groups = [], isFetching: groupsLoading } = useFetchGroupsByCategory(category);
  const missingGroups = showGroups && !groupsLoading
    ? selectedGroups.filter((id) => !groups.some((group) => group.id === id))
    : [];

  const createDraft = handleSubmit(async (values) => {
    if (submitting.current) return;
    setServerError(null);
    if (!values.start) setError("start", { message: "Choose a new start date" });
    if (!values.end) setError("end", { message: "Choose a new end date" });
    if (!values.start || !values.end) return;

    const payload = makeDuplicatePayload(values, values.start, values.end);
    const parsed = eventSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          setError(field as keyof DuplicateForm, { message: issue.message });
        }
      }
      return;
    }
    if (isDuplicateRangeWhollyPast(values.end, allDay)) {
      setError("end", { message: "Choose a schedule that has not wholly passed" });
      return;
    }
    if (missingGroups.length) {
      setError("includedGroups", { message: "A copied group is no longer available. Choose a current group." });
      return;
    }

    submitting.current = true;
    try {
      const created = await saveEvent(formatEventPayload(parsed.data));
      toastSuccess("Draft created", "Review the new event before submitting it.");
      onCreated(created);
    } catch (error) {
      setServerError(isUnknownCreateOutcome(error)
        ? "The request outcome is unknown. Check your recent drafts before trying again."
        : error instanceof Error ? error.message : "Could not create the draft.");
    } finally {
      submitting.current = false;
    }
  });

  return (
    <form onSubmit={createDraft} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/50 p-5">
        <SheetTitle className="text-xl">Duplicate event</SheetTitle>
        <SheetDescription>
          Source: {source.title} · {format(source.start, "MMM d, yyyy")}. This creates a new Draft. The original is unchanged.
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput label="Title" {...register("title")} error={errors.title?.message} />
          <FormInput label="Location" {...register("location")} error={errors.location?.message} />
        </div>
        <div>
          <Label className="mb-1 block text-sm font-semibold">Category</Label>
          <Controller name="category" control={control} render={({ field }) => (
            <ComboBox className="w-full" selectedValue={field.value} choices={EVENT_CHOICES}
              placeholder="Select event category" searchFallbackMsg="Category not found"
              onSelect={(value) => { field.onChange(value); setValue("includedGroups", []); }} />
          )} />
        </div>
        {showGroups && (
          <div>
            <Label className="mb-1 block text-sm font-semibold">Included Groups</Label>
            <Controller name="includedGroups" control={control} render={({ field }) => (
              <CheckboxGroup className="w-full" placeholder="Select target groups"
                choices={groups.map((group) => ({ id: group.id, label: group.name }))}
                selectedValues={field.value} onSelect={field.onChange} />
            )} />
            {(missingGroups.length > 0 || errors.includedGroups) && (
              <p className="mt-1 text-sm text-rose-600" role="alert">
                {errors.includedGroups?.message ?? "A copied group is no longer available. Choose a current group."}
              </p>
            )}
          </div>
        )}
        <div>
          <Label htmlFor="duplicate-description" className="mb-1 block text-sm font-semibold">Description</Label>
          <Controller name="description" control={control} render={({ field }) => (
            <Textarea id="duplicate-description" className="min-h-24" {...field} value={field.value ?? ""} />
          )} />
          {errors.description && <p className="text-sm text-rose-600" role="alert">{errors.description.message}</p>}
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold">New schedule</p>
          <div className="flex items-center gap-3">
            <Label htmlFor="duplicate-all-day">All day</Label>
            <Controller name="allDay" control={control} render={({ field }) => (
              <Switch id="duplicate-all-day" checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["start", "end"] as const).map((name) => (
              <div key={name} className="min-w-0">
                <Controller name={name} control={control} render={({ field }) => (
                  <DateTimeForm label={name === "start" ? "Start" : "End"} date={field.value}
                    onDateTimeChange={field.onChange} allDay={allDay} />
                )} />
                {errors[name] && <p className="mt-1 text-sm text-rose-600" role="alert">{errors[name]?.message}</p>}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Attendance, reviews, and time-out mode are not copied.</p>
        {serverError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{serverError}</p>}
      </div>

      <SheetFooter className="shrink-0 flex-row gap-2 border-t border-slate-200 bg-white p-4 sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
        <Button type="submit" disabled={isPending || groupsLoading || missingGroups.length > 0}>
          {isPending ? "Creating…" : "Create draft"}
        </Button>
      </SheetFooter>
    </form>
  );
}
