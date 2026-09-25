import type { ColumnDef } from "@tanstack/react-table";
import type { ProgressRow } from "@/globals/utils/attendanceProgress";

const yearLabel = (value: string) => value.replace("YEAR_", "Year ").replace("GRADE_", "Grade ");
const clock = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export const progressColumns: ColumnDef<ProgressRow>[] = [
  { accessorKey: "studentId", header: "Student ID", enableSorting: false },
  { accessorKey: "fullName", header: "Name", enableSorting: false },
  { accessorKey: "yearLevel", header: "Year / Grade", enableSorting: false, cell: ({ row }) => yearLabel(row.original.yearLevel) },
  { accessorKey: "sectionLabel", header: "Section", enableSorting: false },
  { id: "status", header: "Recorded status", enableSorting: false,
    cell: ({ row }) => row.original.checkedIn ? "Checked in" : row.original.recordNeedsReview ? "Not yet · record needs review" : "Not yet checked in" },
  { id: "timein", header: "Time in", enableSorting: false, cell: ({ row }) => clock(row.original.timein) },
];
