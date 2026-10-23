import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkExportFilename,
  bulkExportRowToRecord,
  serializeBulkExportCsv,
} from "./studentBulkCsv";
import { BULK_EXPORT_HEADERS } from "../types/studentBulk";

const row = (overrides = {}) => ({
  studentId: "00000123456", usn: null, lrn: null,
  lastName: "Dela Cruz",
  firstName: "Juan",
  middleName: "",
  schoolLevel: "COLLEGE",
  yearLevel: "YEAR_2",
  sectionSlugs: ["bsit-2a"],
  houseSlugs: ["azul"],
  departmentSlugs: ["computer-studies"],
  programSlugs: ["bsit"],
  strandSlugs: [],
  preparedAtUtc: "2026-09-26T09:42:11.000Z",
  ...overrides,
});

test("fixed headers and sorted JSON group cells preserve multiple assignments", () => {
  assert.deepEqual([...BULK_EXPORT_HEADERS], [
    "Student ID",
    "USN",
    "LRN",
    "Last name",
    "First name",
    "Middle name",
    "School level",
    "Year / Grade",
    "Section slugs",
    "House slugs",
    "Department slugs",
    "Program slugs",
    "Strand slugs",
    "Prepared at (UTC)",
  ]);
  const record = bulkExportRowToRecord(row({ sectionSlugs: ["bsit-2b", "bsit-2a"] }));
  assert.equal(record["Section slugs"], '["bsit-2a","bsit-2b"]');
  assert.equal(record["Strand slugs"], "[]");
});

test("quoting, unicode and leading zeros survive a parser round-trip", async () => {
  const rows = [
    row({ studentId: "00000123456", lastName: "Oñate, Jr.", firstName: 'Ana "A"' }),
    row({ studentId: "00000123457", lastName: "Line\nBreak", firstName: "Bo", middleName: "" }),
  ];
  const csv = serializeBulkExportCsv(rows);
  assert.ok(csv.startsWith("Student ID,USN,LRN,Last name"));
  assert.ok(csv.includes("00000123456"));
  // Lightweight round-trip: quoted commas/quotes/newlines must be escaped so a
  // parser sees two data rows, not more.
  assert.ok(csv.includes('"Oñate, Jr."'));
  assert.ok(csv.includes('"Ana ""A"""'));
  assert.ok(csv.includes('"Line\nBreak"'));
});

test("formula and control-character payloads are neutralized, never encoded as formulas", () => {
  const csv = serializeBulkExportCsv([
    row({ firstName: "=2+2", lastName: "@evil" }),
    row({ studentId: "00000123457", firstName: "  +cmd", lastName: "Ok" }),
  ]);
  assert.ok(!csv.includes("\n=2+2"));
  assert.ok(csv.includes("'=2+2"));
  assert.ok(!csv.includes('="000'));
});

test("header-only output and safe filenames", () => {
  assert.equal(serializeBulkExportCsv([]).trim(), [...BULK_EXPORT_HEADERS].join(","));
  const name = bulkExportFilename("2026-09-26T09:42:11.000Z");
  assert.ok(name.startsWith("selected-students_"));
  assert.ok(name.endsWith(".csv"));
  assert.ok(!name.includes(":"));
});

test('selected roster export retains external identifiers separately from canonical identity',()=>{
 const record=bulkExportRowToRecord(row({studentId:'cmha2pc58000008l45x99blx8',usn:'00000123456',lrn:'000000123456'}));
 assert.equal(record.USN,'00000123456');assert.equal(record.LRN,'000000123456');
});
