import assert from "node:assert/strict";
import test from "node:test";

import { buildAttendanceProgress } from "./attendanceProgress";
import { parseProgressQuery } from "./attendanceProgressQuery";

const group = (id: string, name: string, category = "SECTION") => ({ id, name, slug: id, category });
const student = (
  id: string,
  groups: ReturnType<typeof group>[],
  timein: Date | null = null,
  timeout: Date | null = null,
) => ({
  id, firstName: id, middleName: null, lastName: "Student", schoolLevel: "COLLEGE" as const,
  yearLevel: "YEAR_2" as const, groups,
  records: timein || timeout ? [{ timein, timeout }] : [],
});

test("counts only recorded time-ins and partitions duplicate and multiple group assignments", () => {
  const students = [
    student("01", [group("a", "Same")], new Date("2026-09-25T08:00:00Z")),
    student("02", [group("b", "Same")], new Date("2026-09-25T09:00:00Z"), new Date("2026-09-25T12:00:00Z")),
    student("03", [group("a", "Same"), group("b", "Same")]),
    student("04", [], null, new Date("2026-09-25T12:00:00Z")),
    student("05", []),
  ];
  const result = buildAttendanceProgress({
    students,
    query: parseProgressQuery(new URLSearchParams("groupBy=SECTION&includeRows=1&bucket=multiple&status=NOT_YET&page=9&pageSize=10")),
    selectedGroup: null,
  });
  assert.deepEqual(result.totals, { eligible: 5, checkedIn: 2, notYet: 3, rate: 40 });
  assert.equal(result.diagnostics.recordsWithoutTimeIn, 1);
  assert.deepEqual(result.breakdown.map((b) => [b.bucketKey, b.eligible, b.checkedIn]), [
    ["g:a", 1, 1], ["g:b", 1, 1], ["multiple", 1, 0], ["none", 2, 0],
  ]);
  assert.equal(result.detail?.page, 1);
  assert.equal(result.detail?.matchedCount, 1);
  assert.deepEqual(result.detail?.rows.map((row) => row.studentId), ["03"]);
});

test("search and status narrow detail without changing denominators", () => {
  const students = [student("01", [group("a", "A")]), student("02", [group("a", "A")], new Date())];
  const result = buildAttendanceProgress({
    students,
    query: parseProgressQuery(new URLSearchParams("includeRows=1&bucket=g:a&status=ALL&q=02")),
    selectedGroup: group("a", "A"),
  });
  assert.equal(result.totals.eligible, 2);
  assert.equal(result.detail?.bucketTotals.eligible, 2);
  assert.equal(result.detail?.matchedCount, 1);
  assert.equal(result.detail?.rows[0].studentId, "02");
  assert.equal(result.detail?.rows[0].fullName, "Student, 02");
});

test("detail search and display retain the full middle name", () => {
  const person = { ...student("99", []), firstName: "Juan", middleName: "Miguel", lastName: "Dela Cruz" };
  const result = buildAttendanceProgress({
    students: [person], query: parseProgressQuery(new URLSearchParams("includeRows=1&q=Miguel")), selectedGroup: null,
  });
  assert.deepEqual(result.detail?.rows.map((row) => row.studentId), ["99"]);
  assert.equal(result.detail?.rows[0].fullName, "Dela Cruz, Juan Miguel");
});

test("zero audience has no rate and invalid query values fail closed", () => {
  const result = buildAttendanceProgress({ students: [], query: parseProgressQuery(new URLSearchParams()), selectedGroup: null });
  assert.equal(result.totals.rate, null);
  for (const query of ["groupBy=ALL", "page=0", "page=1x", "pageSize=20", "includeRows=yes", "bucket=g:", "q=" + "x".repeat(101), "groupBy=YEAR&bucket=none"]) {
    assert.throws(() => parseProgressQuery(new URLSearchParams(query)));
  }
});

test("year uses stored year level and rejects relation buckets", () => {
  const students = [student("01", []), { ...student("02", []), yearLevel: "GRADE_11" as const }];
  const result = buildAttendanceProgress({
    students,
    query: parseProgressQuery(new URLSearchParams("groupBy=YEAR&includeRows=1&bucket=y:GRADE_11")),
    selectedGroup: null,
  });
  assert.deepEqual(result.breakdown.map((b) => b.bucketKey), ["y:GRADE_11", "y:YEAR_2"]);
  assert.deepEqual(result.detail?.rows.map((row) => row.studentId), ["02"]);
});
