import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyStudentImport, normalizeStudentImportRow } from "./classify";
import type { CanonicalRow, ExistingImportStudent, ImportGroup, ParsedImportRow } from "./contract";

const groups: ImportGroup[] = [
  { id: "sec", slug: "bsit-1a", name: "BSIT 1A", category: "SECTION" },
  { id: "sec2", slug: "bsit-2a", name: "BSIT 2A", category: "SECTION" },
  { id: "house", slug: "red", name: "Red", category: "HOUSE" },
  { id: "program", slug: "bsit", name: "BSIT", category: "PROGRAM" },
  { id: "dept", slug: "cs", name: "Computer Studies", category: "DEPARTMENT" },
  { id: "strand", slug: "stem", name: "STEM", category: "STRAND" },
];
const college: CanonicalRow = { id: "00000000001", firstName: "Jane", lastName: "Doe", middleName: "", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: "bsit-1a", house: "red", program: "bsit", department: "cs", strand: "" };
const row = (student: Partial<CanonicalRow> = {}, csvRow = 2): ParsedImportRow => ({ csvRow, student: { ...college, ...student } });
const existing = (overrides: Partial<ExistingImportStudent> = {}): ExistingImportStudent => ({ id: college.id, firstName: "Jane", lastName: "Doe", middleName: null, schoolLevel: "COLLEGE", yearLevel: "YEAR_1", groups: groups.slice(0, 1).concat(groups.slice(2, 5)), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...overrides });

test("classification creates College and SHS rows and skips identical existing students", () => {
  const result = classifyStudentImport({ rows: [row(), row({ id: "ABC00000002", schoolLevel: "SHS", yearLevel: "GRADE_11", program: "", department: "", strand: "stem" }, 3), row({ id: "00000000003" }, 4)], groups, students: [existing({ id: "00000000003" })] });
  assert.deepEqual(result.rows.map((r) => r.status), ["CREATE", "CREATE", "UNCHANGED"]);
  assert.deepEqual(result.counts, { total: 3, create: 2, update: 0, unchanged: 1, blocked: 0 });
  assert.deepEqual(result.rows[2].changes, []);
  assert.deepEqual(result.rows[0].groupIds.slice().sort(), ["dept", "house", "program", "sec"]);
});

test("updates expose exact scalar and relationship diffs in canonical field order", () => {
  const result = classifyStudentImport({ rows: [row({ firstName: "Janet", middleName: "Lee", yearLevel: "YEAR_2", section: "bsit-2a" })], groups, students: [existing()] });
  assert.equal(result.rows[0].status, "UPDATE");
  assert.deepEqual(result.rows[0].changes, [
    { field: "firstName", before: "Jane", after: "Janet" },
    { field: "middleName", before: null, after: "Lee" },
    { field: "yearLevel", before: "YEAR_1", after: "YEAR_2" },
    { field: "section", before: "bsit-1a", after: "bsit-2a" },
  ]);
});

test("normalization trims identity and names, lowers slugs, and keeps enums strict", () => {
  const normalized = normalizeStudentImportRow({ ...college, id: " 00000000001 ", firstName: " Jane ", middleName: " \t ", section: " BSIT-1A ", strand: " \t ", schoolLevel: "college" });
  assert.equal(normalized.id, "00000000001");
  assert.equal(normalized.firstName, "Jane");
  assert.equal(normalized.middleName, "");
  assert.equal(normalized.section, "bsit-1a");
  assert.equal(normalized.strand, "");
  assert.equal(normalized.schoolLevel, "college");
  const result = classifyStudentImport({ rows: [{ csvRow: 9, student: normalized }], groups, students: [] });
  assert.equal(result.rows[0].status, "BLOCKED");
  assert.ok(result.rows[0].reasons.some((r) => r.code === "INVALID_STUDENT" && r.field === "schoolLevel"));
});

test("unknown group counts are grouped by category and slug; wrong category stays distinct", () => {
  const result = classifyStudentImport({ rows: [row({ section: "missing", house: "missing" }), row({ id: "00000000002", section: " MISSING " }, 3), row({ id: "00000000003", section: "red" }, 4)], groups, students: [] });
  assert.deepEqual(result.unknownGroups, [
    { slug: "missing", category: "SECTION", referenceCount: 2 },
    { slug: "missing", category: "HOUSE", referenceCount: 1 },
  ]);
  assert.deepEqual(result.rows.map((r) => r.status), ["BLOCKED", "BLOCKED", "BLOCKED"]);
  assert.ok(result.rows[2].reasons.some((r) => r.code === "GROUP_CATEGORY_MISMATCH" && r.field === "section"));
});

test("all copies of duplicate IDs are blocked even when far apart", () => {
  const result = classifyStudentImport({ rows: [row(), row({ id: "00000000002" }, 2002), row({ id: " 00000000001 " }, 5005)], groups, students: [] });
  assert.deepEqual(result.rows.map((r) => r.status), ["BLOCKED", "CREATE", "BLOCKED"]);
  assert.ok(result.rows[2].reasons.some((r) => r.code === "DUPLICATE_ID"));
});

test("shared domain validation blocks invalid level combinations and conditional memberships", () => {
  for (const [student, field] of [
    [{ yearLevel: "GRADE_11" }, "yearLevel"],
    [{ program: "" }, "program"], [{ department: "" }, "department"],
    [{ schoolLevel: "SHS", yearLevel: "GRADE_11", strand: "stem" }, "department"],
    [{ id: "short" }, "id"], [{ firstName: " " }, "firstName"],
  ] as Array<[Partial<CanonicalRow>, string]>) {
    const result = classifyStudentImport({ rows: [row(student)], groups, students: [] });
    assert.equal(result.rows[0].status, "BLOCKED");
    assert.ok(result.rows[0].reasons.some((r) => r.code === "INVALID_STUDENT" && r.field === field));
  }
  assert.equal(classifyStudentImport({ rows: [row({ strand: " \t ", middleName: " \t " })], groups, students: [] }).rows[0].status, "CREATE");
});

test("ambiguous or invalid existing relationships block rather than silently replace", () => {
  for (const student of [
    existing({ groups: [...existing().groups, groups[1]] }),
    existing({ groups: [...existing().groups, { id: "bad", slug: "all", name: "All", category: "ALL" }] }),
    existing({ groups: existing().groups.filter((g) => g.category !== "HOUSE") }),
    existing({ groups: [...existing().groups, groups[5]] }),
  ]) {
    const review = classifyStudentImport({ rows: [row()], groups, students: [student] }).rows[0];
    assert.equal(review.status, "BLOCKED");
    assert.ok(review.reasons.some((r) => r.code === "INVALID_EXISTING_STUDENT" || r.code === "AMBIGUOUS_EXISTING_GROUPS"));
  }
});

test("persisted whitespace is an update, not a falsely unchanged normalized value", () => {
  const review = classifyStudentImport({ rows: [row()], groups, students: [existing({ firstName: " Jane " })] }).rows[0];
  assert.equal(review.status, "UPDATE");
  assert.deepEqual(review.changes, [{ field: "firstName", before: " Jane ", after: "Jane" }]);
});

test("existing membership identity conflicts cannot be hidden by matching slugs", () => {
  const current = existing({ groups: existing().groups.map((group) => group.category === "SECTION" ? { ...group, id: "different-section-id" } : group) });
  const review = classifyStudentImport({ rows: [row()], groups, students: [current] }).rows[0];
  assert.equal(review.status, "BLOCKED");
  assert.ok(review.reasons.some((reason) => reason.code === "INVALID_EXISTING_STUDENT" && reason.field === "section"));
});
