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

test("IDs are trimmed opaque identities; blank selections remain invalid", () => {
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
      studentIds: [" "],
      action: "SET_SECTION",
      targetGroupId: "g1",
    }).success,
    false,
  );
});

test('bulk selection accepts opaque generated canonical IDs without treating them as external codes',()=>{
 const id='cmha2pc58000008l45x99blx8';
 assert.equal(bulkPreviewSchema.safeParse({studentIds:[id],action:'SET_HOUSE',targetGroupId:'house'}).success,true);
 assert.equal(bulkExportSelectedSchema.safeParse({studentIds:[id]}).success,true);
});
