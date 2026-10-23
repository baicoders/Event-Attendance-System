import type { ColumnDef } from "@tanstack/react-table";
import { studentName, type CustomGroupMember } from "../types";
import MemberPositionEditor from "../components/MemberPositionEditor";
import RemoveGroupMember from "../components/RemoveGroupMember";

export const getMemberColumns = (isAdmin: boolean): ColumnDef<CustomGroupMember>[] => [
  { id: "name", header: "Student name", accessorFn: (member) => studentName(member.student) },
  { id: "usn", header: "USN", accessorFn: (member) => member.student.usn ?? "", cell: ({ getValue }) => getValue() || "—" },
  { id: "lrn", header: "LRN", accessorFn: (member) => member.student.lrn ?? "", cell: ({ getValue }) => getValue() || "—" },
  {
    accessorKey: "position", header: "Position",
    cell: ({ row }) => isAdmin
      ? <MemberPositionEditor key={row.original.position ?? ""} member={row.original} />
      : row.original.position || "—",
  },
  ...(isAdmin ? [{ id: "actions", header: "Actions", enableSorting: false, cell: ({ row }: { row: { original: CustomGroupMember } }) => <RemoveGroupMember member={row.original} /> }] : []),
];
