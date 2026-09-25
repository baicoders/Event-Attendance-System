import assert from "node:assert/strict";
import test from "node:test";
import { readString } from "react-papaparse";

import { escapeCsvFormula, serializeCsv } from "./csvExport";

test("final mapped cells neutralize formulas behind whitespace and control characters", () => {
  for (const value of ["=1+1", " +SUM(A1)", "\t@cmd", "\r\n-1"]) {
    assert.equal(escapeCsvFormula(value), `'${value}`);
  }
});

test("CSV stays rectangular and quotes names while preserving leading-zero ID bytes", () => {
  const csv = serializeCsv(["Student ID", "Name"], [{ "Student ID": "00000000001", Name: 'A, "B"\nC' }]);
  assert.equal(csv, 'Student ID,Name\r\n00000000001,"A, ""B""\nC"\r\n');
  assert.equal(serializeCsv(["A", "B"], []), "A,B\r\n");
});

test("CSV round-trips Unicode, newlines, and neutralized formula cells", () => {
  const csv = serializeCsv(["Student ID", "Name", "Event title"], [{ "Student ID": "00000000001", Name: 'Ána, "G"\nNext', "Event title": " \t=2+2" }]);
  let parsed: string[][] = [];
  readString(csv, { skipEmptyLines: true, complete: (result) => { parsed = result.data as string[][]; } });
  assert.deepEqual(parsed, [["Student ID", "Name", "Event title"], ["00000000001", 'Ána, "G"\nNext', "' \t=2+2"]]);
});
