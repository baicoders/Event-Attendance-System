import assert from "node:assert/strict";
import { test } from "node:test";
import { audiencePreviewSchema } from "./audiencePreview";

test("preview input deduplicates and sorts group IDs", () => {
  const input = audiencePreviewSchema.parse({ category: "HOUSE", includedGroups: ["b", "a", "b"] });
  assert.deepEqual(input.includedGroups, ["a", "b"]);
  assert.equal(input.page, 1);
  assert.equal(input.pageSize, 50);
});

test("preview input rejects unbounded search and page size", () => {
  assert.equal(audiencePreviewSchema.safeParse({ category: "ALL", includedGroups: [], search: "x".repeat(101) }).success, false);
  assert.equal(audiencePreviewSchema.safeParse({ category: "ALL", includedGroups: [], pageSize: 101 }).success, false);
});
