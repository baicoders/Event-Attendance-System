import assert from "node:assert/strict";
import { test } from "node:test";
import { hasStructuralCsvErrors, parseStudentImportCsv } from "./csv";

const header = "id,lastName,firstName,middleName,schoolLevel,yearLevel,section,house,program,department,strand";
const college = "00000000001,Doe,Jane,,COLLEGE,YEAR_1,bsit-1a,red,bsit,cs,";

test("BOM CRLF and multiline quotes preserve physical source rows and text IDs", () => {
  const result = parseStudentImportCsv(`\uFEFF${header}\r\n\r\n00000000001,"Doe\r\nJunior",Jane,,COLLEGE,YEAR_1,bsit-1a,red,bsit,cs,\r\nABC00000002,"O""Brien",John,,SHS,GRADE_11,stem-a,red,,,stem\r\n`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map((row) => [row.csvRow, row.student.id]), [[3, "00000000001"], [5, "ABC00000002"]]);
  assert.equal(result.rows[0].student.lastName, "Doe\r\nJunior");
  assert.equal(result.rows[1].student.lastName, 'O"Brien');
});

test("missing duplicate and unexpected headers are structural errors", () => {
  const cases = [
    [header.replace(",strand", ""), "MISSING_HEADER"],
    [header.replace("strand", "house"), "DUPLICATE_HEADER"],
    [header + ",registrar", "UNEXPECTED_HEADER"],
    [header.replace("firstName", "FirstName"), "UNEXPECTED_HEADER"],
  ];
  for (const [source, code] of cases) {
    const result = parseStudentImportCsv(source + "\n" + college);
    assert.equal(hasStructuralCsvErrors(result), true);
    assert.ok(result.errors.some((error) => error.code === code));
    assert.deepEqual(result.rows, []);
  }
});

test("empty and header-only sources cannot proceed", () => {
  for (const source of ["", "\uFEFF\r\n", header + "\n\n"]) {
    const result = parseStudentImportCsv(source);
    assert.ok(result.errors.some((error) => error.code === "EMPTY_CSV"));
    assert.equal(hasStructuralCsvErrors(result), true);
  }
});

test("malformed quotes and incorrect cell counts fail structural validation", () => {
  for (const row of [college.replace("Doe", '"Doe'), college.replace("Doe", 'D"oe'), college.replace("Doe", '"Doe"x'), college + ",extra", college.slice(0, -1)]) {
    assert.equal(hasStructuralCsvErrors(parseStudentImportCsv(header + "\n" + row)), true);
  }
});

test("duplicate IDs retain every row for server classification", () => {
  const result = parseStudentImportCsv(`${header}\n${college}\n\n${college.replace("00000000001", " 00000000001 ")}`);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.errors.filter((error) => error.code === "DUPLICATE_ID").map((error) => error.csvRow), [2, 4]);
  assert.equal(hasStructuralCsvErrors(result), false);
});

test("canonical headers can be reordered but cells remain exactly named", () => {
  const result = parseStudentImportCsv(header.split(",").reverse().join(",") + "\n" + college.split(",").reverse().join(","));
  assert.equal(result.rows[0].student.id, "00000000001");
  assert.equal(result.rows[0].student.department, "cs");
  assert.deepEqual(result.errors, []);
});

test("large valid files have no row-count cap", () => {
  const source = header + "\n" + Array.from({ length: 5005 }, (_, i) => college.replace("00000000001", String(i).padStart(11, "0"))).join("\n");
  const result = parseStudentImportCsv(source);
  assert.equal(result.rows.length, 5005);
  assert.deepEqual(result.errors, []);
});

test("duplicate diagnostics stay bounded for a large repeated-ID source", () => {
  const result = parseStudentImportCsv(header + "\n" + Array(5005).fill(college).join("\n"));
  assert.equal(result.rows.length, 5005);
  assert.equal(result.errors.length, 5005);
  assert.ok(result.errors.every((error) => error.message.length < 200));
});
