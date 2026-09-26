import assert from "node:assert/strict";
import { test } from "node:test";
import { studentEditVersion } from "./studentDetail";
import { hasAmbiguousStudentGroups } from "./studentGroupReview";
import { decodeStudentPageId, safeStudentReturnHref } from "./studentReturn";

const base = {
  id: "00000123456", createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"), firstName: "Ana",
  lastName: "Lee", middleName: null, schoolLevel: "COLLEGE", yearLevel: "YEAR_2",
  groups: [{ id: "a", slug: "sec-a", category: "SECTION", name: "Section A" }],
};

test("version ignores group order and cosmetic names but detects membership and scalar edits", () => {
  const second = { id: "b", slug: "azul", category: "HOUSE", name: "Azul" };
  const initial = studentEditVersion({ ...base, groups: [base.groups[0], second] });
  assert.equal(initial, studentEditVersion({ ...base, groups: [{ ...second, name: "New label" }, base.groups[0]] }));
  assert.notEqual(initial, studentEditVersion({ ...base, groups: [base.groups[0]] }));
  assert.notEqual(initial, studentEditVersion({ ...base, firstName: "Anne", groups: [base.groups[0], second] }));
});

test("ambiguous memberships cannot enter a single-valued editor", () => {
  assert.equal(hasAmbiguousStudentGroups(base.groups), false);
  assert.equal(hasAmbiguousStudentGroups([...base.groups, { id: "b", slug: "sec-b", category: "SECTION", name: "Section B" }]), true);
  assert.equal(hasAmbiguousStudentGroups([...base.groups, { id: "c", slug: "year-2", category: "YEAR", name: "Year 2" }]), true);
});

test("return target keeps only known roster paths and parameters", () => {
  assert.equal(safeStudentReturnHref("/students/student-list?category=COLLEGE&department=cs&redirect=https://evil.test#x"), "/students/student-list?category=COLLEGE&department=cs");
  assert.equal(safeStudentReturnHref("//evil.test/students"), "/students");
  assert.equal(safeStudentReturnHref("/students/%2e%2e/admin"), "/students");
  assert.equal(safeStudentReturnHref("https://evil.test/students"), "/students");
});

test("page route decodes one encoded URL segment, including encoded separators", () => {
  assert.equal(decodeStudentPageId("12345%2F67890"), "12345/67890");
  assert.equal(decodeStudentPageId("abc%252F1234"), "abc%2F1234");
  assert.equal(decodeStudentPageId("abc%invalid"), "abc%invalid");
});
