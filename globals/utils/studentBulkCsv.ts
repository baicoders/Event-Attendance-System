import { BULK_EXPORT_HEADERS, type BulkExportRow } from "../types/studentBulk";

/**
 * Pure CSV serialization for the selected-student extract. Kept free of DOM
 * and network access so it can be unit-tested with `node --import tsx --test`.
 */

const DANGEROUS_START = /^[=+\-@\t\r]/;
const CONTROL_PREFIX = /^[\s\u0000-\u001F\u007F\u00A0\u2000-\u200B\u2028\u2029]+[=+\-@]/;

function neutralizeCell(value: string): string {
  if (DANGEROUS_START.test(value) || CONTROL_PREFIX.test(value)) {
    return `'${value}`;
  }
  return value;
}

function csvCell(value: string): string {
  const safe = neutralizeCell(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function bulkExportRowToRecord(row: BulkExportRow): Record<string, string> {
  const slugs = (values: string[]) => JSON.stringify([...values].sort());
  return {
    "Student ID": row.studentId,
    "Last name": row.lastName,
    "First name": row.firstName,
    "Middle name": row.middleName,
    "School level": row.schoolLevel,
    "Year / Grade": row.yearLevel,
    "Section slugs": slugs(row.sectionSlugs),
    "House slugs": slugs(row.houseSlugs),
    "Department slugs": slugs(row.departmentSlugs),
    "Program slugs": slugs(row.programSlugs),
    "Strand slugs": slugs(row.strandSlugs),
    "Prepared at (UTC)": row.preparedAtUtc,
  };
}

export function serializeBulkExportCsv(rows: BulkExportRow[]): string {
  const header = [...BULK_EXPORT_HEADERS].map(csvCell).join(",");
  if (rows.length === 0) return `${header}\n`;
  const lines = [...rows]
    .sort((a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.studentId.localeCompare(b.studentId),
    )
    .map((row) => {
      const record = bulkExportRowToRecord(row);
      return [...BULK_EXPORT_HEADERS].map((h) => csvCell(record[h] ?? "")).join(",");
    });
  return `${header}\n${lines.join("\n")}\n`;
}

export function bulkExportFilename(preparedAt: Date | string): string {
  const instant = preparedAt instanceof Date ? preparedAt : new Date(preparedAt);
  const stamp = Number.isNaN(instant.getTime())
    ? new Date().toISOString()
    : instant.toISOString();
  const safe = stamp.replace(/[:.]/g, "-");
  return `selected-students_${safe}.csv`;
}

export const __testables = { neutralizeCell, csvCell };
