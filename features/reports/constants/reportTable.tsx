import { studentDisplayIdentifier } from "@/globals/utils/studentDisplay";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";

import StatusBadge, { type Tone } from "@/globals/components/shared/StatusBadge";
import { labelForGroup } from "@/globals/constants/groups";
import type { ReportRow } from "@/globals/types/reports";
import {
  ATTENDANCE_OUTCOME_LABEL,
  type AttendanceOutcome,
} from "@/globals/utils/attendance";

/**
 * Columns for the per-event attendance report.
 *
 * Replaces `eventRecordsTable.tsx`'s `reportColumns`, which could only express
 * present/absent and read a nested `section` object. Every value here is already
 * a primitive on `ReportRow`, so no `accessorFn` has to flatten a relation.
 */

/** Outcome → semantic tone. A static map; never build the class at runtime. */
export const OUTCOME_TONE: Record<AttendanceOutcome, Tone> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
};

const formatTime = (value: string | null) =>
  value ? format(new Date(value), "h:mm a") : "—";

/** Sorts nulls last regardless of direction, instead of treating them as epoch 0. */
const timeSortValue = (value: string | null) =>
  value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;

export const reportColumns: ColumnDef<ReportRow>[] = [
  {
    accessorKey: "studentId",
    header: "Student No.",
    cell: ({ row }) => (
      <span className="font-mono text-sm text-slate-700">
        {studentDisplayIdentifier(row.original)}
      </span>
    ),
  },
  {
    accessorKey: "fullName",
    header: "Name",
    cell: ({ getValue }) => (
      <span className="font-medium text-slate-900">{getValue() as string}</span>
    ),
  },
  {
    id: "identifier",
    accessorFn: (row) => [row.usn, row.lrn].filter(Boolean).join(" / "),
    header: "USN/LRN",
    cell: ({ getValue }) => <span className="font-mono text-sm text-slate-700">{(getValue() as string) || "—"}</span>,
  },
  {
    accessorKey: "customGroup",
    header: "Group",
    cell: ({ getValue }) => <span className="text-sm text-slate-600">{(getValue() as string) || "—"}</span>,
  },
  {
    accessorKey: "position",
    header: "Position",
    cell: ({ getValue }) => <span className="text-sm text-slate-600">{(getValue() as string) || "—"}</span>,
  },
  {
    id: "yearLevel",
    accessorFn: (row) => labelForGroup("YEAR", row.yearLevel),
    header: "Year",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-sm text-slate-600">
        {getValue() as string}
      </span>
    ),
    enableGlobalFilter: false,
  },
  {
    id: "section",
    accessorFn: (row) => row.section ?? "",
    header: "Section",
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600">
        {(getValue() as string) || "—"}
      </span>
    ),
    enableGlobalFilter: false,
  },
  {
    id: "timein",
    accessorFn: (row) => timeSortValue(row.timein),
    header: "Time in",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm text-slate-600">
        {formatTime(row.original.timein)}
      </span>
    ),
    enableGlobalFilter: false,
  },
  {
    id: "timeout",
    accessorFn: (row) => timeSortValue(row.timeout),
    header: "Time out",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm text-slate-600">
        {formatTime(row.original.timeout)}
      </span>
    ),
    enableGlobalFilter: false,
  },
  {
    id: "method",
    accessorFn: (row) => row.method ?? "",
    header: "Method",
    cell: ({ row }) =>
      row.original.method ? (
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {row.original.method === "SCANNED" ? "Scanned" : "Manual"}
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      ),
    enableGlobalFilter: false,
  },
  {
    id: "outcome",
    accessorFn: (row) => row.outcome,
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={OUTCOME_TONE[row.original.outcome]} withDot>
          {ATTENDANCE_OUTCOME_LABEL[row.original.outcome]}
        </StatusBadge>
        {/* Only ever set when the event actually collected time-outs. */}
        {row.original.noTimeout ? (
          <StatusBadge tone="info">No time-out</StatusBadge>
        ) : null}
      </div>
    ),
    enableGlobalFilter: false,
  },
];
