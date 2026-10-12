import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventStudentFilter, isStudentInEvent } from "./buildEventStudentFilter";
import type { Event } from "@/globals/types/events";
import type { Student } from "@/globals/types/students";

function scope(category: Event["category"], slugs: string[] = []): Event {
  return { category, includedGroups: slugs.map((slug) => ({ slug })) } as Event;
}

test("school-level audiences need no groups and never fall through to empty", () => {
  assert.deepEqual(buildEventStudentFilter(scope("COLLEGE")), { schoolLevel: "COLLEGE", groups: { none: { slug: "employees" } } });
  assert.deepEqual(buildEventStudentFilter(scope("SHS")), { schoolLevel: "SHS", groups: { none: { slug: "employees" } } });
  assert.deepEqual(buildEventStudentFilter(scope("ALL")), { groups: { none: { slug: "employees" } } });
});

test("scoped audiences fail closed and use union membership", () => {
  assert.deepEqual(buildEventStudentFilter(scope("DEPARTMENT")), { id: { in: [] }, groups: { none: { slug: "employees" } } });
  assert.deepEqual(buildEventStudentFilter(scope("DEPARTMENT", ["cs", "business"])), {
    groups: { none: { slug: "employees" }, some: { slug: { in: ["cs", "business"] } } },
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

 test("employees are excluded even from ALL, COLLEGE and matching group audiences", () => {
   const employee = { schoolLevel: "COLLEGE", groups: [{ slug: "employees" }, { slug: "cs" }] } as Student;
   for (const event of [scope("ALL"), scope("COLLEGE"), scope("DEPARTMENT", ["cs"])]) {
     assert.equal(isStudentInEvent(employee, event), false);
   }
 });
