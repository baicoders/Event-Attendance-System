import type { ImportSource } from '../components/ImportSourceStep';
import { MAX_IMPORT_BYTES } from './contract';
import { parseStudentImportCsv, hasStructuralCsvErrors } from './csv';

/** Runs in a worker in the browser; the server independently validates canonical CSV. */
export async function parseImportSource(fileName: string, bytes: ArrayBuffer): Promise<ImportSource> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MiB upload limit.');
  let csv: string;
  let sheetName: string | undefined;
  if (/\.xlsx$/i.test(fileName)) {
    const converted = await (await import('./xlsx')).studentXlsxToCsv(bytes);
    csv = converted.csv;
    sheetName = converted.sheetName;
  } else if (/\.csv$/i.test(fileName)) {
    csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } else throw new Error('Choose a CSV or XLSX student import file.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
  const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const parsed = parseStudentImportCsv(csv);
  return { fileName, size: bytes.byteLength, csv, sourceHash, rowCount: parsed.rows.length, errors: parsed.errors,
    structurallyValid: !hasStructuralCsvErrors(parsed), ...(sheetName ? { sheetName } : {}) };
}
