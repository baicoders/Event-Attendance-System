import { CSV_HEADERS, MAX_IMPORT_BYTES, type CanonicalRow, type ImportCsvError, type ParsedStudentImport } from "./contract";

/** Duplicate identity is a row blocker; every other parser error invalidates the source. */
export function hasStructuralCsvErrors(result: ParsedStudentImport | ImportCsvError[]): boolean {
  const errors = Array.isArray(result) ? result : result.errors;
  return errors.some((error) => error.code !== "DUPLICATE_ID");
}

/** Strict RFC-style cells with source line identity, including quoted CRLF/newlines. */
export function parseStudentImportCsv(csv: string): ParsedStudentImport {
  const errors: ImportCsvError[] = [];
  const fail = (code: string, message: string, csvRow?: number): ParsedStudentImport => ({ rows: [], errors: [...errors, { code, message, ...(csvRow === undefined ? {} : { csvRow }) }] });
  if (csv.length > MAX_IMPORT_BYTES || new TextEncoder().encode(csv).byteLength > MAX_IMPORT_BYTES) return fail("FILE_TOO_LARGE", "CSV exceeds the 10 MiB technical byte limit.");
  const source = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const records: Array<{ csvRow: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let line = 1;
  let rowStart = 1;
  let mode: "plain" | "quoted" | "closed" = "plain";
  let recordHasContent = false;
  const finishRecord = () => {
    cells.push(cell);
    if (recordHasContent || cells.length > 1 || cell.trim() !== "") records.push({ csvRow: rowStart, cells });
    cells = []; cell = ""; mode = "plain"; recordHasContent = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (mode === "quoted") {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; } else mode = "closed";
      } else if (char === "\r" || char === "\n") {
        cell += char;
        if (char === "\r" && source[i + 1] === "\n") { cell += "\n"; i++; }
        line++;
      } else cell += char;
      continue;
    }
    if (char === ",") {
      cells.push(cell); cell = ""; mode = "plain"; recordHasContent = true;
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && source[i + 1] === "\n") i++;
      line++; rowStart = line;
    } else if (char === '"' && cell.length === 0 && mode === "plain") {
      mode = "quoted"; recordHasContent = true;
    } else if (char === '"' || mode === "closed") {
      return fail("MALFORMED_CSV", "Unexpected quote or text after a closing quote.", rowStart);
    } else {
      cell += char;
      if (char.trim() !== "") recordHasContent = true;
    }
  }
  if (mode === "quoted") return fail("MALFORMED_CSV", "Unclosed quoted CSV cell.", rowStart);
  finishRecord();
  if (records.length === 0) return fail("EMPTY_CSV", "Choose a CSV with a header and at least one student row.");
  const header = records[0];
  const seen = new Set<string>();
  for (const name of header.cells) {
    if (seen.has(name)) errors.push({ csvRow: header.csvRow, code: "DUPLICATE_HEADER", message: `Duplicate header: ${name}.` });
    seen.add(name);
    if (!(CSV_HEADERS as readonly string[]).includes(name)) errors.push({ csvRow: header.csvRow, code: "UNEXPECTED_HEADER", message: `Unexpected header: ${name}.` });
  }
  for (const name of CSV_HEADERS) {
    if (!seen.has(name)) errors.push({ csvRow: header.csvRow, code: "MISSING_HEADER", message: `Missing required header: ${name}.` });
  }
  if (errors.length) return { rows: [], errors };
  if (records.length === 1) return fail("EMPTY_CSV", "The CSV contains no student rows.");
  const rows: ParsedStudentImport["rows"] = [];
  for (const record of records.slice(1)) {
    if (record.cells.length !== CSV_HEADERS.length) errors.push({ csvRow: record.csvRow, code: "COLUMN_COUNT", message: `Expected ${CSV_HEADERS.length} cells; found ${record.cells.length}.` });
    else rows.push({ csvRow: record.csvRow, student: Object.fromEntries(header.cells.map((name, i) => [name, record.cells[i]])) as CanonicalRow });
  }
  if (errors.length) return { rows: [], errors };
  const rowsById = new Map<string, number[]>();
  for (const row of rows) {
    const id = row.student.id.trim();
    const identities = rowsById.get(id) ?? [];
    identities.push(row.csvRow); rowsById.set(id, identities);
  }
  for (const [id, csvRows] of rowsById) {
    if (csvRows.length > 1) {
      const message = `Student ID "${id}" appears ${csvRows.length} times (first CSV row ${csvRows[0]}).`;
      for (const csvRow of csvRows) errors.push({ csvRow, code: "DUPLICATE_ID", message });
    }
  }
  return { rows, errors };
}
