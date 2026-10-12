import assert from "node:assert/strict";
import { test } from "node:test";
import { studentSchema } from "@/globals/schemas/studentSchema";
import { hasAmbiguousStudentGroups } from "@/globals/utils/studentGroupReview";
import { classifyStudentImport } from "@/features/students/import/classify";
import { parseLibraryScanResult } from "./scanResult";

const form = { id: "00000000001", firstName: "Juan", lastName: "Cruz", middleName: "", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: "bsit-1a", house: "red", program: "bsit", department: "cs", strand: "" } as const;
const groups = [{ id: "sec", slug: "bsit-1a", name: "BSIT 1A", category: "SECTION" }, { id: "house", slug: "red", name: "Red", category: "HOUSE" }, { id: "prog", slug: "bsit", name: "BSIT", category: "PROGRAM" }, { id: "dept", slug: "cs", name: "CS", category: "DEPARTMENT" }] as const;
test("employees is reserved from ordinary academic section assignment", () => {
  assert.equal(studentSchema.safeParse({ ...form, section: "employees" }).success, false);
});
test("ordinary roster edits and imports cannot remove employee membership", () => {
  const employeeGroups = [{ id: "emp", slug: "employees", name: "Employees", category: "SECTION" as const }, ...groups.filter(g => g.category !== "SECTION")];
  assert.equal(hasAmbiguousStudentGroups(employeeGroups), true);
  const result = classifyStudentImport({ rows: [{ csvRow: 2, student: { ...form } }], groups: [...groups, employeeGroups[0]], students: [{ ...form, groups: employeeGroups, createdAt: new Date(), updatedAt: new Date() }] });
  assert.equal(result.rows[0].status, "BLOCKED");
});
test("scan success payload must describe the requested visitor and a valid recorded operation", () => {
  const valid = { operation: "TIME_IN", visit: { id: "visit", studentId: form.id, personType: "STUDENT", timeIn: "2026-10-12T00:00:00.000Z", timeOut: null, student: { id: form.id, firstName: "Juan", lastName: "Cruz", middleName: null } } };
  assert.equal(parseLibraryScanResult(valid, form.id).operation, "TIME_IN");
  assert.throws(() => parseLibraryScanResult({}, form.id));
  assert.throws(() => parseLibraryScanResult(valid, "00000000002"));
  assert.throws(() => parseLibraryScanResult({ ...valid, operation: "TIME_OUT" }, form.id));
});

test("bulk roster changes cannot assign or remove the reserved employee section", async () => {
  const { buildBulkPreviewRows } = await import("@/globals/utils/studentBulkPreview");
  const student = { ...form, groups: [...groups], createdAt: new Date(), updatedAt: new Date() };
  const employeeGroup = { id: "emp", slug: "employees", name: "Employees", category: "SECTION" };
  const assign = buildBulkPreviewRows({ orderedIds: [form.id], studentsById: new Map([[form.id, student]]), target: employeeGroup, action: "SET_SECTION" });
  assert.equal(assign.rows[0].status, "BLOCKED");
  const remove = buildBulkPreviewRows({ orderedIds: [form.id], studentsById: new Map([[form.id, { ...student, groups: [employeeGroup, ...groups.filter(g => g.category !== "SECTION")] }]]), target: groups[0], action: "SET_SECTION" });
  assert.equal(remove.rows[0].status, "BLOCKED");
});
