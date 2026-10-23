import assert from "node:assert/strict";
import test from "node:test";
import { resolveSheetGrouping } from "./printGrouping";

test("explicit grouping overrides legacy links while older print links keep their behavior", () => {
  assert.equal(resolveSheetGrouping(undefined), "SECTION");
  assert.equal(resolveSheetGrouping(undefined, "0"), "NONE");
  assert.equal(resolveSheetGrouping("CUSTOM", "0"), "CUSTOM");
  assert.equal(resolveSheetGrouping("NONE", "1"), "NONE");
  assert.equal(resolveSheetGrouping(["CUSTOM", "NONE"], "0"), "NONE");
});
