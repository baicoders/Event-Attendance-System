import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createDisposableDb, createTestClient } from "@/globals/libs/testDb";
import { updateStudentDetail } from "./studentEdit";
import { studentEditVersion } from "./studentDetail";

test("edit-only transaction detects stale and deleted records and preserves groups on failure", async () => {
  const disposable = await createDisposableDb("test");
  const { db, disconnect } = createTestClient(disposable.url);
  const typed = db as PrismaClient;
  const form = { id: "00000123456", firstName: "Ana", lastName: "Lee", middleName: "",
    schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_2" as const,
    section: "sec-a", house: "azul", department: "cs", program: "bsit", strand: "" };
  try {
    for (const [id, slug, category] of [["sec", "sec-a", "SECTION"], ["sec-b", "sec-b", "SECTION"], ["house", "azul", "HOUSE"], ["dept", "cs", "DEPARTMENT"], ["program", "bsit", "PROGRAM"]] as const)
      await typed.group.create({ data: { id, slug, name: slug, category } });
    await typed.student.create({ data: { id: form.id, firstName: form.firstName, lastName: form.lastName,
      schoolLevel: form.schoolLevel, yearLevel: form.yearLevel,
      groups: { connect: [{ id: "sec" }, { id: "house" }, { id: "dept" }, { id: "program" }] } } });
    const initial = await typed.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    const version = studentEditVersion(initial);
    const saved = await updateStudentDetail(typed, form.id, { expectedVersion: version, student: { ...form, firstName: "Anne" } });
    assert.equal(saved.kind, "ok");
    assert.equal(saved.kind === "ok" && saved.student.firstName, "Anne");
    assert.equal((await updateStudentDetail(typed, form.id, { expectedVersion: version, student: form })).kind, "conflict");
    assert.equal((await typed.student.findUniqueOrThrow({ where: { id: form.id } })).firstName, "Anne");
    const current = await typed.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    const noOp = await updateStudentDetail(typed, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Anne" } });
    assert.equal(noOp.kind === "ok" && noOp.changed, false);
    assert.equal((await typed.student.findUniqueOrThrow({ where: { id: form.id } })).updatedAt.toISOString(), current.updatedAt.toISOString());
    const invalid = await updateStudentDetail(typed, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Changed", section: "missing" } });
    assert.equal(invalid.kind, "invalid-groups");
    assert.equal((await typed.student.findUniqueOrThrow({ where: { id: form.id } })).firstName, "Anne");
    // PostgreSQL failure injection: a trigger that aborts the join write, so
    // the whole edit transaction rolls back and groups are preserved.
    await typed.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION block_sec_b() RETURNS trigger AS $$ BEGIN IF NEW."A" = 'sec-b' THEN RAISE EXCEPTION 'blocked relation write'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await typed.$executeRawUnsafe(`CREATE TRIGGER fail_section_connect BEFORE INSERT ON "_GroupToStudent" FOR EACH ROW EXECUTE FUNCTION block_sec_b()`);
    await assert.rejects(updateStudentDetail(typed, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Failed", section: "sec-b" } }));
    await typed.$executeRawUnsafe(`DROP TRIGGER fail_section_connect ON "_GroupToStudent"`);
    await typed.$executeRawUnsafe(`DROP FUNCTION block_sec_b()`);
    const afterRollback = await typed.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    assert.equal(afterRollback.firstName, "Anne");
    assert.deepEqual(afterRollback.groups.map(group => group.id).sort(), current.groups.map(group => group.id).sort());
    await typed.group.update({ where: { id: "sec-b" }, data: { students: { connect: { id: form.id } } } });
    const ambiguous = await typed.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    assert.equal(ambiguous.updatedAt.toISOString(), current.updatedAt.toISOString());
    assert.notEqual(studentEditVersion(ambiguous), studentEditVersion(current));
    assert.equal((await updateStudentDetail(typed, form.id, { expectedVersion: studentEditVersion(ambiguous), student: form })).kind, "group-review");
    await typed.student.delete({ where: { id: form.id } });
    assert.equal((await updateStudentDetail(typed, form.id, { expectedVersion: version, student: form })).kind, "not-found");
    assert.equal(await typed.student.count(), 0);
  } finally {
    await disconnect();
    await disposable.cleanup();
  }
});
