import {
  toastDanger,
  toastSuccess,
  toastWarning,
} from "@/globals/components/shared/toasts";
import { useDeleteRecord, useCreateRecord } from "@/globals/hooks/useRecords";
import { NewRecord } from "@/globals/types/records";
import React from "react";
import { IconType } from "react-icons/lib";
import { ATTENDANCE_STATUS_ICONS } from "@/features/attendance/constants/attendanceStatus";
import { Button } from "@/globals/components/shad-cn/button";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";

type Props = {
  eventId: string;
  studentId: string;
  recordId?: string;
  /** When true, the event records time-outs, so the "present" action means Time Out. */
  isTimeout?: boolean;
  /** Whether the student already has a time-in for this event. */
  hasTimeIn?: boolean;
  /** Whether the student already has a time-out for this event. */
  hasTimeOut?: boolean;
  /** Whether the user may delete records (event owner or admin). */
  canManage?: boolean;
  onRecord?: () => void;
  operationBusy?: boolean;
};

const AttendanceActionButtons = ({
  eventId,
  studentId,
  recordId,
  isTimeout = false,
  hasTimeIn = false,
  hasTimeOut = false,
  canManage = false,
  onRecord,
  operationBusy = false,
}: Props) => {
  // The "present" action records a time-in normally and a time-out while the
  // event is in timeout mode, so its label must reflect the current mode.
  // Deleting (Absent) requires event ownership, matching the records table.
  const actionButtons: {
    action: "present" | "absent";
    icon: IconType;
    label: string;
    title: string;
    color: string;
  }[] = [
    {
      action: "present",
      icon: ATTENDANCE_STATUS_ICONS.present,
      label: isTimeout ? "Time Out" : "Time In",
      title: isTimeout ? "Record time-out" : "Record time-in",
      color: "text-emerald-600",
    },
    ...(canManage
      ? [
          {
            action: "absent" as const,
            icon: ATTENDANCE_STATUS_ICONS.absent,
            label: "Absent",
            title: "Mark as Absent (Delete Record)",
            color: "text-red-400",
          },
        ]
      : []),
  ];
  const { mutateAsync: createRecord, isPending: isCreating } =
    useCreateRecord(eventId);
  const { mutateAsync: deleteRecord, isPending: isDeleting } =
    useDeleteRecord(eventId);
  const confirm = useConfirm();

  const isLoading = isCreating || isDeleting;

  const handleAction = async (action: "present" | "absent") => {
    if (action === "present") {
      if (onRecord) {
        onRecord();
        return;
      }
      try {
        const result = await createRecord({
          eventId,
          studentId,
          method: "MANUAL",
        } as NewRecord);

        if (!result.changed) {
          toastWarning(
            isTimeout
              ? "Student was already timed out."
              : "Attendance was already recorded.",
          );
        } else if (isTimeout) {
          if (!result.timein) toastWarning("Time-out recorded; no time-in is recorded for this student.");
          else toastSuccess("Time-out recorded");
        } else if (!recordId) {
          toastSuccess("Student marked as present");
        } else {
          toastSuccess("Updated student record");
        }
      } catch (error) {
        toastWarning(
          `Failed to set record: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } else {
      // Absent action = Delete
      if (!recordId) return; // Already absent

      const confirmed = await confirm({
        title: "Mark as absent?",
        description:
          "This removes the student record from this event. This is an irreversable action.",
      });

      if (!confirmed) return;

      try {
        await deleteRecord(recordId);
        toastSuccess("Attendance record removed");
      } catch (error) {
        toastDanger(
          `Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-2 justify-center items-center">
      {actionButtons.map(({ action, icon: Icon, label, title, color }) => {
        // Disable rules:
        // - "absent": nothing to delete when there's no record.
        // - "present" in timeout mode: can't time out again once already done.
        // - "present" in normal mode: already timed in, nothing left to do.
        const presentDisabled =
          action === "present" &&
          (isTimeout ? hasTimeOut : hasTimeIn);
        const isDisabled =
          isLoading || operationBusy || (action === "absent" && !recordId) || presentDisabled;

        return (
          <Button
            key={action}
            onClick={() => handleAction(action)}
            disabled={isDisabled}
            variant={"outline"}
            size="lg"
            title={title}
            className={`${color} flex items-center justify-center text-xs rounded-full transition-colors hover:scale-110 active:scale-95 ${
              isDisabled ? "opacity-30 grayscale" : ""
            }`}
          >
            <Icon className={`w-5 h-5 ${color}`} />
            {label}
          </Button>
        );
      })}
    </div>
  );
};

export default AttendanceActionButtons;
