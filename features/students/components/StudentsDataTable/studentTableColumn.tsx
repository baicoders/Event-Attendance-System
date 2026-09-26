import { ColumnDef } from "@tanstack/react-table";
import { Student } from "@/globals/types/students";
import { formatSection, normalizeName } from "@/globals/utils/formatting";
import { Delete, Edit, QrCode, History } from "lucide-react";
import { Checkbox } from "@/globals/components/shad-cn/checkbox";

type ColumnArgs = {
  onEdit: (student: Student) => void;
  onDelete: (id: string) => void;
  onViewQR: (student: Student) => void;
  onHistory: (student: Student) => void;
};

export const getStudentColumns = ({
  onEdit,
  onDelete,
  onViewQR,
  onHistory,
}: ColumnArgs): ColumnDef<Student>[] => [
  {
    id: "select",
    header: ({ table }) => <Checkbox aria-label="Select all filtered students" checked={table.getFilteredRowModel().rows.length > 0 && table.getFilteredRowModel().rows.every((row) => row.getIsSelected()) ? true : table.getFilteredRowModel().rows.some((row) => row.getIsSelected()) ? "indeterminate" : false} onCheckedChange={(checked) => {
      table.setRowSelection((previous) => {
        const next = { ...previous };
        table.getFilteredRowModel().rows.forEach((row) => { if (checked) next[row.id] = true; else delete next[row.id]; });
        return next;
      });
    }} />,
    cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.id}`} checked={row.getIsSelected()} onCheckedChange={(checked) => row.toggleSelected(!!checked)} />,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: () => <div className="text-center">Student ID</div>,
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
  },
  {
    accessorKey: "lastName",
    header: () => <div className="text-center">Last Name</div>,
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
  },
  {
    accessorKey: "firstName",
    header: () => <div className="text-center">First Name</div>,
    cell: ({ getValue }) => (
      <div className="text-center">{getValue() as string}</div>
    ),
  },
  {
    accessorKey: "middleName",
    header: () => <div className="text-center">M.I.</div>,
    cell: ({ getValue }) => (
      <div className="text-center">{(getValue() as string) || "-"}</div>
    ),
  },
  {
    accessorKey: "schoolLevel",
    filterFn: "equalsString",
    header: () => <div className="text-center">Level</div>,
    cell: ({ getValue }) => (
      <div className="text-center uppercase">
        {normalizeName(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    accessorKey: "yearLevel",
    filterFn: "equalsString",
    header: () => <div className="text-center">Year / Grade</div>,
    cell: ({ getValue }) => (
      <div className="text-center uppercase">
        {normalizeName(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    accessorKey: "department",
    filterFn: "equalsString",
    header: () => <div className="text-center">Department</div>,
    cell: ({ getValue }) => (
      <div className="text-center">
        {normalizeName(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    accessorKey: "program",
    filterFn: "equalsString",
    header: () => <div className="text-center">Program</div>,
    cell: ({ getValue }) => (
      <div className="text-center uppercase">
        {(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    accessorKey: "strand",
    filterFn: "equalsString",
    header: () => <div className="text-center">Strand</div>,
    cell: ({ getValue }) => (
      <div className="text-center uppercase">{(getValue() as string) || "-"}</div>
    ),
  },
  {
    accessorKey: "house",
    filterFn: "equalsString",
    header: () => <div className="text-center">House</div>,
    cell: ({ getValue }) => (
      <div className="text-center uppercase">
        {(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    accessorKey: "section",
    filterFn: "equalsString",
    header: () => <div className="text-center">Section</div>,
    cell: ({ getValue }) => (
      <div className="text-center">
        {formatSection(getValue() as string) || "-"}
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <div className="text-center">Actions</div>,
    cell: ({ row }) => {
      const student = row.original;
      return (
        <div className="flex items-center justify-center gap-2 md:gap-3">
          <button type="button" aria-label={`View QR for ${student.id}`} title="View QR" className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-indigo-700 transition hover:bg-indigo-100 md:px-2 md:text-xs" onClick={() => onViewQR(student)}>
            <QrCode className="size-3.5" strokeWidth={1.6} /> <span>QR</span>
          </button>
          <button type="button" aria-label={`Attendance history for ${student.id}`} title="Attendance history" className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-[0.65rem] font-semibold text-indigo-700 transition hover:bg-indigo-100" onClick={() => onHistory(student)}>
            <History className="size-3.5" strokeWidth={1.6} /> <span>History</span>
          </button>
          <button
            type="button"
            aria-label={`Edit ${student.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-100 md:px-2 md:text-xs"
            onClick={() => onEdit(student)}
          >
            <Edit className="size-3.5" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${student.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-rose-700 transition hover:border-rose-400 hover:bg-rose-100 md:px-2 md:text-xs"
            onClick={() => onDelete(student.id)}
          >
            <Delete className="size-3.5" strokeWidth={1.6} />
          </button>
        </div>
      );
    },
  },
];
