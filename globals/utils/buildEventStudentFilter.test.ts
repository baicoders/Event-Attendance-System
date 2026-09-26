import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventStudentFilter, isStudentInEvent } from "./buildEventStudentFilter";
import type { Event } from "@/globals/types/events";
import type { Student } from "@/globals/types/students";

function scope(category: Event["category"], slugs: string[] = []): Event {
  return { category, includedGroups: slugs.map((slug) => ({ slug })) } as Event;
}

test("school-level audiences need no groups and never fall through to empty", () => {
  assert.deepEqual(buildEventStudentFilter(scope("COLLEGE")), { schoolLevel: "COLLEGE" });
  assert.deepEqual(buildEventStudentFilter(scope("SHS")), { schoolLevel: "SHS" });
  assert.deepEqual(buildEventStudentFilter(scope("ALL")), {});
});

test("scoped audiences fail closed and use union membership", () => {
  assert.deepEqual(buildEventStudentFilter(scope("DEPARTMENT")), { id: { in: [] } });
  assert.deepEqual(buildEventStudentFilter(scope("DEPARTMENT", ["cs", "business"])), {
    groups: { some: { slug: { in: ["cs", "business"] } } },
  });
});

test("client convenience eligibility follows the same category rules", () => {
  const student = { schoolLevel: "COLLEGE", groups: [{ slug: "business" }] } as Student;
  assert.equal(isStudentInEvent(student, scope("ALL")), true);
  assert.equal(isStudentInEvent(student, scope("COLLEGE")), true);
  assert.equal(isStudentInEvent(student, scope("SHS")), false);
  assert.equal(isStudentInEvent(student, scope("DEPARTMENT")), false);
  assert.equal(isStudentInEvent(student, scope("DEPARTMENT", ["cs", "business"])), true);
});
