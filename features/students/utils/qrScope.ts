import { Student } from "@/globals/types/students";
import { StudentListCategory } from "../types";

export type QRPrintScope = "selected" | "filtered" | "roster";
export const QR_FILTER_FIELDS = ["schoolLevel", "yearLevel", "department", "program", "strand", "house", "section"] as const;
export type QRFilterField = (typeof QR_FILTER_FIELDS)[number];

export function getRosterContext(params: URLSearchParams) {
  const raw = params.get("category");
  const category: StudentListCategory = raw === "COLLEGE" || raw === "SHS" || raw === "HOUSE" ? raw : "ALL";
  const key = category === "COLLEGE" ? "department" : category === "SHS" ? "strand" : category === "HOUSE" ? "house" : null;
  const filters: Record<string, string> = { category };
  const allowedFilters = category === "COLLEGE" ? ["department", "program", "house"] : category === "SHS" ? ["strand", "house"] : ["house"];
  if (!raw || raw === category) {
    for (const field of allowedFilters) {
      const value = params.get(field);
      if (value) filters[field] = value;
    }
  }
  return { category, filters, label: category === "ALL" ? "All Students" : category === "COLLEGE" ? "College Department" : category === "SHS" ? "Senior High Strand" : "House", item: key ? params.get(key) || "" : "" };
}

export function filterQRStudents(students: Student[], search: string, filters: Partial<Record<QRFilterField, string>>) {
  const needle = search.trim().toLocaleLowerCase();
  return students.filter((student) => {
    if (QR_FILTER_FIELDS.some((field) => filters[field] && String(student[field] || "") !== filters[field])) return false;
    if (!needle) return true;
    return [student.id, student.firstName, student.middleName, student.lastName, student.schoolLevel, student.yearLevel, student.department, student.program, student.strand, student.house, student.section]
      .some((value) => String(value || "").toLocaleLowerCase().includes(needle));
  });
}

export function studentsForPrint(students: Student[], filtered: Student[], selectedIds: Set<string>, scope: QRPrintScope) {
  return scope === "roster" ? students : scope === "filtered" ? filtered : students.filter((student) => selectedIds.has(student.id));
}
