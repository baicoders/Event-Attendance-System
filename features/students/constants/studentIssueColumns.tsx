import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { Student } from "@/globals/types/students";
import { Button } from "@/globals/components/shad-cn/button";
import StudentDataIssueBadges from "../components/StudentDataIssueBadges";
export const issueProfileHref = (student: Student, returnTo: string) =>
  `/students/${encodeURIComponent(student.id)}?returnTo=${encodeURIComponent(returnTo)}`;
export const studentAcademicLabel = (student: Student) =>
  [
    student.schoolLevel,
    student.yearLevel?.replaceAll("_", " "),
    ...(student.groups ?? []).map((group) => group.name),
  ]
    .filter(Boolean)
    .join(" · ") || "Not provided";
export function getStudentIssueColumns(returnTo: string): ColumnDef<Student>[] {
  const columns: ColumnDef<Student>[] = [
    {
      id: "name",
      header: "Student",
      accessorFn: (student) => `${student.lastName}, ${student.firstName}`,
      cell: ({ row }) => (
        <span className="font-medium text-slate-900">
          {row.original.lastName},{" "}
          {[row.original.firstName, row.original.middleName]
            .filter(Boolean)
            .join(" ")}
        </span>
      ),
    },
    {
      accessorKey: "usn",
      header: "USN",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.usn || "—"}</span>
      ),
    },
    {
      accessorKey: "lrn",
      header: "LRN",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.lrn || "—"}</span>
      ),
    },
    {
      id: "academics",
      header: "School / academics",
      accessorFn: studentAcademicLabel,
      cell: ({ row }) => (
        <span className="text-xs text-slate-600">
          {studentAcademicLabel(row.original)}
        </span>
      ),
    },
    {
      id: "issues",
      header: "Record issues",
      cell: ({ row }) => <StudentDataIssueBadges student={row.original} />,
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => (
        <Button asChild size="sm" variant="outline">
          <Link href={issueProfileHref(row.original, returnTo)}>
            <Pencil className="size-3.5" />
            Edit record
          </Link>
        </Button>
      ),
    },
  ];
  return columns.map((column) => ({ ...column, enableSorting: false }));
}
