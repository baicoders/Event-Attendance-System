import assert from "node:assert/strict";
import { test } from "node:test";
import { commitRequestSchema, importRequestSchema } from "./contract";

const request = { v: 1, fileName: "students.csv", sourceHash: "a".repeat(64), csv: "id" };

test("import boundary accepts canonical v1 source and requires reviewed commit", () => {
  assert.equal(importRequestSchema.safeParse(request).success, true);
  assert.equal(commitRequestSchema.safeParse(request).success, false);
  assert.equal(commitRequestSchema.safeParse({ ...request, previewToken: "signed-review" }).success, true);
});

test("request rejects aliases, extra keys, path-like names and malformed hashes", () => {
  for (const invalid of [
    { ...request, v: 2 }, { ...request, students: [] },
    { ...request, fileName: "../students.csv" }, { ...request, fileName: "C:\\students.csv" },
    { ...request, fileName: "\n.csv" }, { ...request, fileName: "a".repeat(201) },
    { ...request, fileName: " " }, { ...request, sourceHash: "z".repeat(64) },
    { ...request, sourceHash: "a".repeat(63) },
  ]) assert.equal(importRequestSchema.safeParse(invalid).success, false);
  assert.equal(commitRequestSchema.safeParse({ ...request, previewToken: "a".repeat(4097) }).success, false);
});

test("source has an actual UTF-8 technical byte boundary", () => {
  assert.equal(importRequestSchema.safeParse({ ...request, csv: "a".repeat(10 * 1024 * 1024) }).success, true);
  assert.equal(importRequestSchema.safeParse({ ...request, csv: "a".repeat(10 * 1024 * 1024 + 1) }).success, false);
  assert.equal(importRequestSchema.safeParse({ ...request, csv: "é".repeat(5 * 1024 * 1024 + 1) }).success, false);
});
