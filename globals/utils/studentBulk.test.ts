import assert from "node:assert/strict";
import test from "node:test";
import { buildBulkPreviewRows } from "./studentBulkPreview";

const baseStudent = (overrides: Partial<Parameters<typeof buildBulkPreviewRows>[0]["studentsById"] extends Map<string, infer V> ? V : never> & { id: string }) => ({
  firstName: "Juan",
  lastName: "Dela Cruz",
  middleName: null,
  schoolLevel: "COLLEGE",
  yearLevel: "YEAR_2",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  groups: [
    { id: "sec-a", slug: "bsit-2a", name: "BSIT 2A", category: "SECTION" },
    { id: "house-azul", slug: "azul", name: "Azul", category: "HOUSE" },
    { id: "dept-cs", slug: "computer-studies", name: "CS", category: "DEPARTMENT" },
    { id: "prog-bsit", slug: "bsit", name: "BSIT", category: "PROGRAM" },
  ],
  ...overrides,
});

const target = { id: "sec-b", slug: "bsit-2b", name: "BSIT 2B", category: "SECTION" };

test("category preservation: only the chosen relation is proposed, scalars untouched", () => {
  const studentsById = new Map([
    ["00000123456", baseStudent({ id: "00000123456" })],
  ]);
  const { rows, counts } = buildBulkPreviewRows({
    orderedIds: ["00000123456"],
    studentsById: studentsById as never,
    target,
    action: "SET_SECTION",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "CHANGE");
  assert.equal(rows[0].before.slug, "bsit-2a");
  assert.equal(rows[0].after.slug, "bsit-2b");
  assert.equal(counts.changed, 1);
});

test("same target rows are no-ops, not counted as changes", () => {
  const studentsById = new Map([
    ["00000123456", baseStudent({ id: "00000123456", groups: [
      { id: "sec-b", slug: "bsit-2b", name: "BSIT 2B", category: "SECTION" },
      { id: "house-azul", slug: "azul", name: "Azul", category: "HOUSE" },
      { id: "dept-cs", slug: "computer-studies", name: "CS", category: "DEPARTMENT" },
      { id: "prog-bsit", slug: "bsit", name: "BSIT", category: "PROGRAM" },
    ] })],
  ]);
  const { rows, counts } = buildBulkPreviewRows({
    orderedIds: ["00000123456"],
    studentsById: studentsById as never,
    target,
    action: "SET_SECTION",
  });
  assert.equal(rows[0].status, "UNCHANGED");
  assert.equal(counts.changed, 0);
  assert.equal(counts.unchanged, 1);
});

test("multiple memberships in the changed category block without cleanup", () => {
  const s = baseStudent({ id: "00000123480" });
  (s.groups as unknown[]).push({ id: "sec-c", slug: "bsit-2c", name: "BSIT 2C", category: "SECTION" });
  const studentsById = new Map([["00000123480", s]]);
  const { rows } = buildBulkPreviewRows({
    orderedIds: ["00000123480"],
    studentsById: studentsById as never,
    target,
    action: "SET_SECTION",
  });
  assert.equal(rows[0].status, "BLOCKED");
  assert.equal(rows[0].reasonCode, "MULTIPLE_MEMBERSHIPS");
});

test("missing students block with a concrete reason", () => {
  const { rows } = buildBulkPreviewRows({
    orderedIds: ["00000123490"],
    studentsById: new Map(),
    target,
    action: "SET_SECTION",
  });
  assert.equal(rows[0].status, "BLOCKED");
  assert.equal(rows[0].reasonCode, "STUDENT_NOT_FOUND");
});

test("leading-zero eleven-character IDs are preserved byte-for-byte", () => {
  const id = "00000123456";
  const studentsById = new Map([[id, baseStudent({ id })]]);
  const { rows } = buildBulkPreviewRows({
    orderedIds: [id],
    studentsById: studentsById as never,
    target,
    action: "SET_SECTION",
  });
  assert.equal(rows[0].id, "00000123456");
});
