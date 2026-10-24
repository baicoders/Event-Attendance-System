import type { ImportReason, ImportReviewRow } from './contract';

const HEADERS = ['Source row', 'Sheet', 'Student name', 'USN', 'LRN', 'Field', 'Actual value', 'Problem', 'Corrective action'];

/** Quoting alone does not stop spreadsheet formulas, including after whitespace. */
function cell(value: string): string {
  const safe = /^[\s\u0000-\u001f\u007f\u200b]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function correctiveAction(reason: ImportReason): string {
  switch (reason.code) {
    case 'UNKNOWN_GROUP':
    case 'GROUP_CATEGORY_MISMATCH':
    case 'INVALID_GROUP':
      return 'Use an existing group slug in the correct category; correct the source file and review again.';
    case 'IDENTITY_CONFLICT':
      return 'Review the identifiers and name against the official source; resolve the identity manually before reviewing again.';
    case 'DUPLICATE_ID':
      return 'Keep one verified row per student and identifier; remove duplicate source rows and review again.';
    case 'EXCLUDED_ENROLLMENT_STATUS':
      return 'Remove this excluded enrollment row from the import file and review again.';
    case 'INVALID_EXISTING_STUDENT':
    case 'AMBIGUOUS_EXISTING_GROUPS':
      return 'Review and correct the existing student profile or group configuration, then prepare a fresh review.';
    default:
      return 'Correct the indicated field in the source file using the import requirements, then replace the file and review again.';
  }
}

/** Exports exceptions from this review only, never previous values or other roster records. */
export function serializeImportIssuesCsv(rows: ImportReviewRow[], sheetName = ''): string {
  const lines = [HEADERS.map(cell).join(',')];
  for (const row of rows) {
    for (const reason of row.reasons) {
      lines.push([
        String(row.csvRow), sheetName,
        [row.student.firstName, row.student.middleName, row.student.lastName].filter(Boolean).join(' '),
        row.student.usn ?? '', row.student.lrn ?? '', reason.field ?? '',
        reason.field ? row.student[reason.field] ?? '' : '', reason.message,
        correctiveAction(reason),
      ].map(cell).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Malformed sources cannot reach review; retain every parser row diagnostic. */
export function serializeSourceIssuesCsv(source: { sheetName?: string; errors: { csvRow?: number; code: string; message: string }[] }): string {
  return [HEADERS.map(cell).join(','), ...source.errors.map(error => [
    error.csvRow === undefined ? '' : String(error.csvRow), source.sheetName ?? '',
    '', '', '', 'source', '', error.message,
    'Correct the source row or canonical headers, replace the file, and review again.',
  ].map(cell).join(','))].join('\r\n') + '\r\n';
}
