import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkExportSelectedSchema,
  bulkPreviewSchema,
} from "./studentBulk";

test("repeated IDs are rejected, not counted twice", () => {
  const result = bulkPreviewSchema.safeParse({
    studentIds: ["00000123456", "00000123456"],
    action: "SET_SECTION",
    targetGroupId: "g1",
  });
  assert.equal(result.success, false);
});

test("mutation and export bounds are enforced", () => {
  const tooMany = Array.from({ length: 101 }, (_, i) => String(10000000000 + i).slice(0, 11).padStart(11, "0"));
  assert.equal(
    bulkPreviewSchema.safeParse({ studentIds: tooMany, action: "SET_HOUSE", targetGroupId: "g1" }).success,
    false,
  );
  const tooManyExport = Array.from({ length: 5001 }, (_, i) => String(i).padStart(11, "0"));
  assert.equal(bulkExportSelectedSchema.safeParse({ studentIds: tooManyExport }).success, false);
});

test("IDs keep eleven-character trimmed shape without digits-only assumption", () => {
  assert.equal(
    bulkPreviewSchema.safeParse({
      studentIds: [" 00000123456 "],
      action: "SET_SECTION",
      targetGroupId: "g1",
    }).success,
    true,
  );
  assert.equal(
    bulkPreviewSchema.safeParse({
      studentIds: ["short"],
      action: "SET_SECTION",
      targetGroupId: "g1",
    }).success,
    false,
  );
});
