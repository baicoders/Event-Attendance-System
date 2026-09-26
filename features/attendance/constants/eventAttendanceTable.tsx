import { ColumnDef, Row } from "@tanstack/react-table";
import { StudentAttendanceRecord } from "@/globals/types/students";
import { Button } from "@/globals/components/shad-cn/button";
import { useUpdateAttendanceRecord } from "@/globals/hooks/useRecords";
import {
  toastDanger,
  toastSuccess,
  toastWarning,
} from "@/globals/components/shared/toasts";
import { ArrowUpDown } from "lucide-react";
import { ATTENDANCE_STATUS_ICONS } from "@/features/attendance/constants/attendanceStatus";
import { Group } from "@prisma/client";
import Link from "next/link";

function ActionsCell({
  row,
  canManage,
}: {
  row: Row<StudentAttendanceRecord>;
  canManage: boolean;
}) {
  const { id: recordId, eventId, studentId } = row.original;
  const { mutateAsync: recordAttendance, isPending: isUpdating } =
    useUpdateAttendanceRecord(eventId);

  const handleRecordAttendance = async () => {
    try {
      const result = await recordAttendance(recordId);
      if (result.changed) {
        if (result.timeout && !result.timein) toastWarning("Time-out recorded; no time-in is recorded for this student.");
        else toastSuccess("Attendance updated");
      } else {
        toastWarning("Attendance was already completed for this student.");
      }
    } catch {
      toastDanger(`Failed to update: ${studentId}`);
    }
  };

  const isLoading = isUpdating;

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
      {canManage && recordId && <Link
        href={`/attendance/corrections?eventId=${encodeURIComponent(eventId)}&studentId=${encodeURIComponent(studentId)}`}
        title="Review or correct attendance"
        className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 underline hover:text-slate-950">
        Review
      </Link>}
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
