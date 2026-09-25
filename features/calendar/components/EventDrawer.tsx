"use client";

import { useRef, useState } from "react";
import { Controller } from "react-hook-form";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/globals/components/shad-cn/drawer";
import { Label } from "@/globals/components/shad-cn/label";
import { Switch } from "@/globals/components/shad-cn/switch";
import { Textarea } from "@/globals/components/shad-cn/textarea";
import { ConfirmDialog } from "@/globals/components/shared/ConfirmModal";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";

import FormInput from "@/globals/components/shared/FormInput";
import ComboBox from "@/globals/components/shared/ComboBox";
import CheckboxGroup from "@/globals/components/shared/CheckboxGroup";
import DateTimeForm from "@/features/calendar/components/DateTimeForm";
import { cn } from "@/globals/libs/shad-cn";

import { useEventForm } from "@/features/calendar/hooks/useEventForm";
import { useAuth } from "@/globals/contexts/AuthContext";
import {
  useDeleteEvent,
  useSaveEvent,
  useApproveEvent,
  useSubmitEvent,
  useStatsOfEvent,
} from "@/globals/hooks/useEvents";
import { EVENT_CHOICES } from "@/features/calendar/constants/categoryGroups"; // Keep just the categories here
import { Event, EventForm } from "@/globals/types/events";
import EventActionButtons from "./EventActionButtons";
import EventAudiencePreview from "./EventAudiencePreview";
import {
  formatEventPayload,
  hasEventAudienceChanged,
  AUDIENCE_CHANGE_HAS_RECORDS_CODE,
} from "@/globals/utils/events";
import { useFetchGroupsByCategory } from "@/globals/hooks/useGroups";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { ApiError } from "@/globals/utils/api";

type EventDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Partial<Event>;
  mode: "create" | "edit";
};

export default function EventDrawer({
  isOpen,
  onClose,
  initialData,
  mode,
}: EventDrawerProps) {
  const isEdit = mode === "edit";
  const { user } = useAuth();
  const confirm = useConfirm();
  const formScrollRef = useRef<HTMLDivElement | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const { mutateAsync: saveEvent, isPending: isSaving } = useSaveEvent();
  const { mutateAsync: deleteEvent, isPending: isDeleting } = useDeleteEvent();
  const { mutateAsync: submitEvent, isPending: isSubmitting } =
    useSubmitEvent();
  const { mutateAsync: approveEvent, isPending: isApproving } =
    useApproveEvent();

  const {
    control,
    handleSubmit,
    resetForm,
    setValue,
    watch,
    register,
    formState: { errors, isDirty },
  } = useEventForm(initialData);

  const category = watch("category");
  const includedGroups = watch("includedGroups");
  const allDay = watch("allDay");

  // FETCH DYNAMIC GROUPS based on selected category
  const { data: availableGroups = [], isLoading: isLoadingGroups } =
    useFetchGroupsByCategory(category);

  // Attendance count for the event being edited, used only to phrase the
  // audience-change confirmation. The server independently enforces the rule;
  // this query is disabled for a create (no id).
  const { data: stats } = useStatsOfEvent(initialData?.id);
  const presentCount = stats?.present ?? 0;

  // Role Checks
  const eventStatus = initialData?.status ?? "DRAFT";
  const isOrganizer = user?.role === "ORGANIZER";
  const isAdmin = user?.role === "ADMIN";
  const isOwner = initialData?.createdById === user?.id;

  // Organizers can't edit approved events (the API only lets them edit drafts
  // and rejected events), so present a read-only drawer even to the owner -
  // otherwise saving returns a 409.
  const isReadOnlyApprovedView =
    isEdit && isOrganizer && eventStatus === "APPROVED";
  const isReadOnlyPendingView =
    isEdit && isOrganizer && eventStatus === "PENDING";
  const isReadOnlyView = isReadOnlyApprovedView || isReadOnlyPendingView;

  // A draft's owner can submit it for review - including an admin who created
  // it, otherwise admin-authored drafts get stranded (the API already allows
  // the owner, admin or not, to submit).
  const canSubmit = eventStatus === "DRAFT" && (isOrganizer || isOwner);
  // Drafts are not approvable: the API requires them to be submitted first,
  // so only offer approval for events actually awaiting a decision.
  const canApprove =
    isAdmin && ["PENDING", "REJECTED"].includes(eventStatus);
  const isBusy =
    isSaving || isSubmitting || isApproving || isDeleting || isLoadingGroups;

  const showIncludedGroups = !["ALL", "COLLEGE", "SHS"].includes(category);

  const handleDrawerClose = () => {
    setIsDeleteConfirmOpen(false);
    resetForm();
    onClose();
  };

  // Only an admin can edit an approved event; if they change its audience
  // (category/includedGroups) while it already has attendance, make them confirm
  // the report consequence. The server enforces the same rule, so a stale count
  // here only affects the messaging, never whether the change is allowed.
  const needsAudienceConfirmation = (data: EventForm) =>
    isEdit &&
    isAdmin &&
    eventStatus === "APPROVED" &&
    presentCount > 0 &&
    hasEventAudienceChanged(initialData ?? {}, data);

  /** Persist an event, prompting once for confirmation when a rescope would
   *  rewrite an already-recorded event's report. Declining aborts the save. */
  const saveWithAudienceConfirmation = async (data: EventForm) => {
    const payload = formatEventPayload(data);

    if (needsAudienceConfirmation(data)) {
      const confirmed = await confirm({
        title: "Change this event's audience?",
        description: `This event already has ${presentCount} attendance record(s). Changing its category or included groups will change who counts toward its report.`,
      });

      if (!confirmed) return null;

      payload.acknowledgeAudienceChange = true;
    }

    try {
      return await saveEvent(payload);
    } catch (error) {
      // Fallback: the local count can be stale or still loading, so the server
      // can reject a rescope we never warned about. Surface the server's own
      // consequence message and let the admin confirm before retrying once.
      if (
        error instanceof ApiError &&
        error.code === AUDIENCE_CHANGE_HAS_RECORDS_CODE &&
        !payload.acknowledgeAudienceChange
      ) {
        const confirmed = await confirm({
          title: "Change this event's audience?",
          description: error.message,
        });

        if (!confirmed) return null;

        return saveEvent({ ...payload, acknowledgeAudienceChange: true });
      }

      throw error;
    }
  };

  const handleSaveDraft = handleSubmit(async (data) => {
    try {
      const saved = await saveWithAudienceConfirmation(data);
      if (!saved) return;
      toastSuccess("Event saved", "Draft updated successfully.");
      onClose();
    } catch (error) {
      toastDanger(
        "Save failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  });

  const handleSubmitForReview = handleSubmit(async (data) => {
    try {
      const saved = await saveWithAudienceConfirmation(data);
      if (!saved) return;
      if (!saved.id) throw Error("No event id");

      await submitEvent({ id: saved.id });
      toastSuccess("Event submitted", "Waiting for admin approval.");
      onClose();
    } catch (error) {
      toastDanger(
        "Submission failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  });

  const handleApproveNow = handleSubmit(async (data) => {
    try {
      const existingId = initialData?.id;
      const isDirectApproval =
        isEdit &&
        !!existingId &&
        !isDirty &&
        ["PENDING", "REJECTED"].includes(eventStatus);
      const saved = isDirectApproval
        ? null
        : await saveWithAudienceConfirmation(data);
      const eventId = isDirectApproval ? existingId : saved?.id;

      // Cancel on the audience confirmation aborts the whole approval.
      if (!isDirectApproval && !saved) return;
      if (!eventId) throw Error("No event id");

      await approveEvent({ id: eventId });
      toastSuccess("Event approved", "The event is now live.");
      onClose();
    } catch (error) {
      toastDanger(
        "Approval failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  });

  const handleDeleteConfirm = async () => {
    if (!initialData?.id) return;
    try {
      await deleteEvent(initialData.id);
      toastSuccess("Event deleted", "The event has been removed.");
      handleDrawerClose();
    } catch (error) {
      toastDanger(
        "Delete failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => !open && handleDrawerClose()}
      direction="bottom"
    >
      <DrawerContent className="mx-auto w-full max-w-2xl overflow-hidden bg-white">
        <form
          onSubmit={(e) => {
            if (!isReadOnlyView) handleSaveDraft(e);
            else e.preventDefault();
          }}
          className="flex h-full min-h-0 flex-col"
        >
          <DrawerHeader className="px-5 pt-2">
            <DrawerTitle className="text-2xl font-bold">
              {isEdit ? "Edit Event" : "Create Event"}
            </DrawerTitle>
            {isReadOnlyApprovedView ? (
              <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-center text-sm text-indigo-700">
                Approved event (view only). Only the event creator or an admin
                can edit this event.
              </p>
            ) : isReadOnlyPendingView ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">
                This event is pending admin review. Editing is temporarily
                locked.
              </p>
            ) : null}
          </DrawerHeader>

          <div
            ref={formScrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-5 pb-6"
          >
            <fieldset
              disabled={isReadOnlyView}
              className={cn(
                "grid grid-cols-1 gap-4 sm:grid-cols-2",
                isReadOnlyView && "opacity-80"
              )}
            >
              <FormInput
                label="Title"
                placeholder="Enter event title"
                {...register("title")}
                error={errors.title?.message}
              />

              {/* Event Location Field */}
              <FormInput
                label="Location"
                placeholder="Enter event location (optional)"
                {...register("location")}
                error={errors.location?.message}
              />

              {/* Category - spans the full width when there's no Included
                  Groups field next to it, so it doesn't leave a half-empty row */}
              <div className={cn(!showIncludedGroups && "sm:col-span-2")}>
                <Label className="mb-1 text-sm font-semibold">Category</Label>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <ComboBox
                      className="w-full"
                      selectedValue={field.value}
                      choices={EVENT_CHOICES}
                      placeholder="Select event category"
                      searchFallbackMsg="Category not found"
                      onSelect={(newCategory) => {
                        field.onChange(newCategory);
                        // Instantly clear groups when category changes
                        setValue("includedGroups", [], {
                          shouldValidate: true,
                        });
                      }}
                    />
                  )}
                />
              </div>

              {/* Included Groups */}
              {showIncludedGroups && (
                <div>
                  <Label className="mb-1 text-sm font-semibold">
                    Included Groups
                  </Label>
                  <Controller
                    name="includedGroups"
                    control={control}
                    render={({ field }) => (
                      <CheckboxGroup
                        className="w-full"
                        placeholder="Select target groups"
                        choices={availableGroups.map((g) => ({
                          id: g.id,
                          label: g.name,
                        }))}
                        selectedValues={field.value}
                        onSelect={field.onChange}
                      />
                    )}
                  />
                  {errors.includedGroups && (
                    <p className="text-sm text-red-500">
                      * {errors.includedGroups.message}
                    </p>
                  )}
                </div>
              )}

              {!isReadOnlyView && (
                <EventAudiencePreview
                  category={category}
                  includedGroups={includedGroups}
                  eventId={isEdit ? initialData?.id : undefined}
                  enabled={isOpen}
                />
              )}

              {/* Schedule Block - full width; Start/End sit side by side once
                  the bottom sheet has room for two columns */}
              <div className="sm:col-span-2">
                <Label className="mb-1 text-sm font-semibold">Schedule</Label>
                <div className="flex flex-col gap-3 rounded-xl border p-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium">All Day</p>
                    <Controller
                      name="allDay"
                      control={control}
                      render={({ field }) => (
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                    <Controller
                      name="start"
                      control={control}
                      render={({ field }) => (
                        <DateTimeForm
                          date={field.value}
                          onDateTimeChange={field.onChange}
                          label="Start"
                          allDay={allDay}
                        />
                      )}
                    />

                    <Controller
                      name="end"
                      control={control}
                      render={({ field }) => (
                        <>
                          <DateTimeForm
                            date={field.value}
                            onDateTimeChange={field.onChange}
                            label="End"
                            allDay={allDay}
                          />
                          {errors.end && (
                            <p className="text-sm text-red-500">
                              * {errors.end.message}
                            </p>
                          )}
                        </>
                      )}
                    />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label
                  htmlFor="description"
                  className="mb-1 text-sm font-semibold text-slate-700"
                >
                  Description
                </Label>
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <Textarea
                      placeholder="Optional description"
                      id="description"
                      className="h-24 resize-none"
                      {...field}
                      value={field.value ?? ""}
                    />
                  )}
                />
              </div>
            </fieldset>
          </div>

          <EventActionButtons
            isEdit={isEdit}
            hasId={!!initialData?.id}
            isReadOnlyView={isReadOnlyView}
            isReadOnlyPendingView={isReadOnlyPendingView}
            canSubmit={canSubmit}
            canApprove={canApprove}
            isBusy={isBusy}
            isDeleting={isDeleting}
            isSaving={isSaving}
            isSubmitting={isSubmitting}
            isApproving={isApproving}
            onClose={handleDrawerClose}
            onDelete={() => setIsDeleteConfirmOpen(true)}
            onSubmitForReview={handleSubmitForReview}
            onApproveNow={handleApproveNow}
          />

          <ConfirmDialog
            title="Delete this event?"
            description="This action cannot be undone."
            isOpen={isDeleteConfirmOpen}
            onCancel={() => setIsDeleteConfirmOpen(false)}
            onConfirm={handleDeleteConfirm}
            isConfirming={isDeleting}
          />
        </form>
      </DrawerContent>
    </Drawer>
  );
}
