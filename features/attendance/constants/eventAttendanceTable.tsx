import { ColumnDef, Row } from "@tanstack/react-table";
import { StudentAttendanceRecord } from "@/globals/types/students";
import { Button } from "@/globals/components/shad-cn/button";
import {
  useDeleteRecord,
  useUpdateAttendanceRecord,
} from "@/globals/hooks/useRecords";
import {
  toastDanger,
  toastSuccess,
  toastWarning,
} from "@/globals/components/shared/toasts";
import { ArrowUpDown } from "lucide-react";
import { ATTENDANCE_STATUS_ICONS } from "@/features/attendance/constants/attendanceStatus";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { Group } from "@prisma/client";

function ActionsCell({
  row,
  canManage,
}: {
  row: Row<StudentAttendanceRecord>;
  canManage: boolean;
}) {
  const { id: recordId, eventId, studentId } = row.original;
  const { mutateAsync: deleteRecord, isPending: isDeleting } =
    useDeleteRecord(eventId);
  const { mutateAsync: recordAttendance, isPending: isUpdating } =
    useUpdateAttendanceRecord(eventId);
  const confirm = useConfirm();

  const handleRecordAttendance = async () => {
    try {
      const result = await recordAttendance(recordId);
      if (result.changed) {
        if (result.timeout && !result.timein) toastWarning("Time-out recorded; no time-in is recorded for this student.");
        else toastSuccess("Attendance updated");
      } else {
        toastWarning("Attendance was already completed for this student.");
      }
    } catch (error) {
      toastDanger(`Failed to update: ${studentId}`);
    }
  };

  const handleDelete = async () => {
    if (!recordId) return;

    const confirmed = await confirm({
      title: "Mark as absent?",
      description:
        "This removes the student record from this event. This is an irreversable action.",
    });

    if (!confirmed) return;

    try {
      await deleteRecord(recordId);
      toastSuccess("Record removed");
    } catch (error) {
      toastDanger(`Failed to delete: ${studentId}`);
    }
  };

  const isLoading = isDeleting || isUpdating;

  // Deleting a record requires event ownership (server-enforced); recording
  // attendance does not. Hide the delete control when the user can't manage.
  const actions = [
    {
      id: "present",
      icon: ATTENDANCE_STATUS_ICONS.present,
      color: "text-emerald-600",
      handler: handleRecordAttendance,
      disabled: isLoading,
      title: "Record attendance",
    },
    ...(canManage
      ? [
          {
            id: "absent",
            icon: ATTENDANCE_STATUS_ICONS.absent,
            color: "text-red-400",
            handler: handleDelete,
            disabled: isLoading || !recordId,
            title: "Mark as Absent (Delete Record)",
          },
        ]
      : []),
  ];

  return (
    <div className="flex gap-2 justify-center items-center">
      {actions.map(({ id, icon: Icon, color, handler, disabled, title }) => (
        <button
          key={id}
          onClick={handler}
          disabled={disabled}
          title={title}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors hover:scale-110 active:scale-95 ${
            disabled ? "opacity-30 grayscale" : ""
          }`}
        >
          <Icon className={`w-5 h-5 ${color}`} />
        </button>
      ))}
    </div>
  );
}

const formatTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    : "N/A";

export const getAttendanceColumns = (
  canManage: boolean
): ColumnDef<StudentAttendanceRecord>[] => [
  {
    accessorKey: "studentId",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Student ID
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
  },
  {
    accessorKey: "fullName",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Full Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
  },
  {
    accessorKey: "schoolLevel",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          School Level
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
    enableGlobalFilter: false,
  },
  {
    accessorKey: "section",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Section
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    cell: ({ getValue }) => (
      <div className="text-center">
        {(getValue() as Group | null)?.name || "N/A"}
      </div>
    ),
    enableGlobalFilter: false,
  },
  {
    accessorKey: "timein",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Time in
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    // Sort by the underlying timestamp, not the localized string (which would
    // order "10:00 AM" before "2:00 PM").
    accessorFn: (row) => (row.timein ? new Date(row.timein).getTime() : 0),
    sortingFn: "basic",
    cell: ({ row }) => (
      <div className="text-center">{formatTime(row.original.timein)}</div>
    ),
    enableGlobalFilter: false,
  },
  {
    accessorKey: "timeout",
    header: ({ column }) => (
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Time out
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    accessorFn: (row) => (row.timeout ? new Date(row.timeout).getTime() : 0),
    sortingFn: "basic",
    cell: ({ row }) => (
      <div className="text-center">{formatTime(row.original.timeout)}</div>
    ),
    enableGlobalFilter: false,
  },
  // {
  //   accessorKey: "status",
  //   header: ({ column }) => (
  //     <div className="text-center">
  //       <Button
  //         variant="ghost"
  //         onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
  //       >
  //         Status
  //         <ArrowUpDown className="ml-2 h-4 w-4" />
  //       </Button>
  //     </div>
  //   ),
  //   cell: ({ getValue }) => (
  //     <div className="text-center">{getValue() as string}</div>
  //   ),
  //   enableGlobalFilter: false,
  // },
  {
    id: "actions",
    header: () => <div className="text-center">Actions</div>,
    cell: ({ row }) => <ActionsCell row={row} canManage={canManage} />,
  },
];
