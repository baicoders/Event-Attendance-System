import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEditedInstant, toManilaInput } from "./correctionTime";

test("untouched Manila input preserves the original millisecond instant", () => {
  const original = "2026-09-25T00:02:14.782Z";
  assert.equal(toManilaInput(original), "2026-09-25T08:02:14");
  assert.equal(resolveEditedInstant("2026-09-25T08:02:14", original), original);
});

test("edited Manila time resolves to an offset-bearing UTC instant", () => {
  assert.equal(resolveEditedInstant("2026-09-25T09:03:02", "2026-09-25T00:02:14.782Z"), "2026-09-25T01:03:02.000Z");
  assert.equal(resolveEditedInstant("", null), null);
});
