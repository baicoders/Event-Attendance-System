import assert from "node:assert/strict";
import test from "node:test";

import { bucketForStudent, GROUP_DIMENSIONS, summarizeGroups } from "./reportGroups";

const section = (id: string, name: string) => ({ id, name, slug: id, category: "SECTION" as const });

test("section buckets keep IDs distinct and put each student in one bucket", () => {
  const students = [
    { id: "1", yearLevel: "YEAR_1" as const, groups: [section("a", "Same")] },
    { id: "2", yearLevel: "YEAR_1" as const, groups: [section("b", "Same")] },
    { id: "3", yearLevel: "YEAR_1" as const, groups: [] },
    { id: "4", yearLevel: "YEAR_1" as const, groups: [section("a", "Same"), section("b", "Same"), section("a", "Same")] },
  ];
  assert.deepEqual(students.map((student) => bucketForStudent(student, "SECTION").key), ["g:a", "g:b", "none", "multiple"]);
  const buckets = summarizeGroups(students.map((student) => ({ student, outcome: "PRESENT" as const })), "SECTION");
  assert.deepEqual(buckets.map((bucket) => bucket.key), ["g:a", "g:b", "none", "multiple"]);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.eligible, 0), 4);
});

test("a real section named Ungrouped differs from the synthetic no-section bucket", () => {
  const real = bucketForStudent({ yearLevel: "YEAR_1", groups: [section("real", "Ungrouped")] }, "SECTION");
  const none = bucketForStudent({ yearLevel: "YEAR_1", groups: [] }, "SECTION");
  assert.equal(real.label, "Ungrouped");
  assert.equal(none.label, "Ungrouped (no section)");
  assert.notEqual(real.key, none.key);
});

test("every supported dimension partitions one student exactly once", () => {
  const student = { yearLevel: "GRADE_11" as const, groups: GROUP_DIMENSIONS.filter((dimension) => dimension !== "YEAR").map((dimension) => ({ id: dimension, name: dimension, slug: dimension, category: dimension })) };
  for (const dimension of GROUP_DIMENSIONS) {
    const buckets = summarizeGroups([{ student, outcome: "LATE" }], dimension);
    assert.equal(buckets.length, 1, dimension);
    assert.equal(buckets[0].eligible, 1, dimension);
    assert.equal(buckets[0].attended, 1, dimension);
    assert.equal(buckets[0].rate, 100, dimension);
  }
  assert.equal(bucketForStudent(student, "YEAR").key, "y:GRADE_11");
});
