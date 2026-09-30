import { studentSchema } from "@/globals/schemas/studentSchema";
import { hasAmbiguousStudentGroups } from "@/globals/utils/studentGroupReview";
import {
  CSV_HEADERS, IMPORT_GROUP_FIELDS, type CanonicalRow, type ExistingImportStudent,
  type ImportChange, type ImportField, type ImportGroup, type ImportGroupField,
  type ImportReason, type ImportReview, type ImportReviewRow, type ParsedImportRow,
  type UnknownImportGroup,
} from "./contract";

const groupFields = Object.keys(IMPORT_GROUP_FIELDS) as ImportGroupField[];
const optionalFields = new Set<ImportField>(["middleName", "program", "department", "strand"]);

/** Keep invalid enum/identity values visible; shared validation decides validity. */
export function normalizeStudentImportRow(row: CanonicalRow): CanonicalRow {
  const normalized = { ...row };
  for (const field of ["id", "firstName", "lastName", "middleName"] as const) normalized[field] = row[field].trim();
  for (const field of groupFields) normalized[field] = row[field].trim().toLowerCase();
  const validated = studentSchema.safeParse(normalized);
  return validated.success ? { ...normalized, ...validated.data } : normalized;
}

function domainReasons(student: CanonicalRow, code = "INVALID_STUDENT"): ImportReason[] {
  const validation = studentSchema.safeParse(student);
  return validation.success ? [] : validation.error.issues.map((issue) => ({
    code, field: issue.path[0] as ImportField, message: issue.message,
  }));
}

function existingRow(student: ExistingImportStudent): CanonicalRow {
  const value: CanonicalRow = { id: student.id, firstName: student.firstName, lastName: student.lastName,
    middleName: student.middleName ?? "", schoolLevel: student.schoolLevel, yearLevel: student.yearLevel,
    section: "", house: "", program: "", department: "", strand: "" };
  for (const field of groupFields) value[field] = student.groups.find((group) => group.category === IMPORT_GROUP_FIELDS[field])?.slug ?? "";
  return value;
}

/** Pure browser-safe domain review. The server signs raw current projections separately. */
export function classifyStudentImport(input: {
  rows: ParsedImportRow[]; groups: ImportGroup[]; students: ExistingImportStudent[];
}): ImportReview {
  const groups = new Map(input.groups.map((group) => [group.slug, group]));
  const students = new Map(input.students.map((student) => [student.id, student]));
  const normalizedRows = input.rows.map((row) => ({ csvRow: row.csvRow, student: normalizeStudentImportRow(row.student) }));
  const idCounts = new Map<string, number>();
  for (const row of normalizedRows) idCounts.set(row.student.id, (idCounts.get(row.student.id) ?? 0) + 1);
  const unknown = new Map<string, UnknownImportGroup>();
  const rows: ImportReviewRow[] = normalizedRows.map(({ csvRow, student }) => {
    const reasons = domainReasons(student);
    const groupIds: string[] = [];
    if (idCounts.get(student.id)! > 1) reasons.push({ code: "DUPLICATE_ID", field: "id", message: `Student ID "${student.id}" occurs more than once in this CSV.` });
    for (const field of groupFields) {
      const slug = student[field];
      if (!slug) continue;
      const category = IMPORT_GROUP_FIELDS[field];
      const group = groups.get(slug);
      if (!group) {
        reasons.push({ code: "UNKNOWN_GROUP", field, message: `Unknown ${category.toLowerCase()} group "${slug}".` });
        const key = `${category}:${slug}`;
        const reference = unknown.get(key) ?? { slug, category, referenceCount: 0 };
        reference.referenceCount++; unknown.set(key, reference);
      } else if (group.category !== category) {
        reasons.push({ code: "GROUP_CATEGORY_MISMATCH", field, message: `"${slug}" is a ${group.category.toLowerCase()} group; ${field} requires ${category.toLowerCase()}.` });
      } else groupIds.push(group.id);
    }
    const before = students.get(student.id);
    const changes: ImportChange[] = [];
    if (before) {
      if (hasAmbiguousStudentGroups(before.groups)) {
        reasons.push({ code: "AMBIGUOUS_EXISTING_GROUPS", message: "Existing student has multiple groups in one category or unsupported memberships. Resolve the roster before importing." });
      } else {
        const previous = existingRow(before);
        reasons.push(...domainReasons(previous, "INVALID_EXISTING_STUDENT"));
        for (const field of groupFields) {
          const membership = before.groups.find((group) => group.category === IMPORT_GROUP_FIELDS[field]);
          const authoritative = membership ? groups.get(membership.slug) : undefined;
          if (membership && authoritative && (membership.id !== authoritative.id || membership.category !== authoritative.category)) {
            reasons.push({ code: "INVALID_EXISTING_STUDENT", field, message: `Existing ${field} membership conflicts with the current Group identity. Resolve the roster before importing.` });
          }
        }
        for (const field of CSV_HEADERS) {
          // Equality is against the stored representation, so trimming persisted
          // names is a visible change rather than an incorrectly skipped write.
          const oldValue = field === "middleName" ? before.middleName : (optionalFields.has(field) && previous[field] === "" ? null : previous[field]);
          const newValue = optionalFields.has(field) && student[field] === "" ? null : student[field];
          if (oldValue !== newValue) changes.push({ field, before: oldValue, after: newValue });
        }
      }
    }
    const status = reasons.length ? "BLOCKED" : !before ? "CREATE" : changes.length ? "UPDATE" : "UNCHANGED";
    return { csvRow, student, status, changes, reasons, groupIds };
  });
  const counts = { total: rows.length, create: 0, update: 0, unchanged: 0, blocked: 0 };
  for (const row of rows) {
    if (row.status === "CREATE") counts.create++;
    else if (row.status === "UPDATE") counts.update++;
    else if (row.status === "UNCHANGED") counts.unchanged++;
    else counts.blocked++;
  }
  return { rows, counts, unknownGroups: [...unknown.values()] };
}
