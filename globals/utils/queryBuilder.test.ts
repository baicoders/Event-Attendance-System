import assert from "node:assert/strict";
import test from "node:test";
import { buildStudentQuery } from "./queryBuilder";

test("custom-group roster uses custom memberships rather than academic groups", () => {
  assert.deepEqual(buildStudentQuery({category: "ALL", customGroupId: "ssc-id"}), {
    AND: [{customMemberships: {some: {groupId: "ssc-id", group: {category: "CUSTOM"}}}}],
  });
});

test("custom-group membership intersects existing school and academic filters", () => {
  const regular = buildStudentQuery({category: "SHS", strand: "stem", house: "azul"});
  const grouped = buildStudentQuery({category: "SHS", strand: "stem", house: "azul", customGroupId: "sslg-id"});
  assert.deepEqual(grouped, {AND: [
    {customMemberships: {some: {groupId: "sslg-id", group: {category: "CUSTOM"}}}},
    ...(regular.AND as object[]),
  ]});
  assert.deepEqual(buildStudentQuery({category: "ALL"}), {});
});
