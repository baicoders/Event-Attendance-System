import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { updateStudentDetail } from "./studentEdit";
import { studentEditVersion } from "./studentDetail";

test("edit-only transaction detects stale and deleted records and preserves groups on failure", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "student-edit-"));
  const url = `file:${join(scratch, "edit.db")}`;
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  const form = { id: "00000123456", firstName: "Ana", lastName: "Lee", middleName: "",
    schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_2" as const,
    section: "sec-a", house: "azul", department: "cs", program: "bsit", strand: "" };
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const [id, slug, category] of [["sec", "sec-a", "SECTION"], ["sec-b", "sec-b", "SECTION"], ["house", "azul", "HOUSE"], ["dept", "cs", "DEPARTMENT"], ["program", "bsit", "PROGRAM"]] as const)
      await db.group.create({ data: { id, slug, name: slug, category } });
    await db.student.create({ data: { id: form.id, firstName: form.firstName, lastName: form.lastName,
      schoolLevel: form.schoolLevel, yearLevel: form.yearLevel,
      groups: { connect: [{ id: "sec" }, { id: "house" }, { id: "dept" }, { id: "program" }] } } });
    const initial = await db.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    const version = studentEditVersion(initial);
    const saved = await updateStudentDetail(db, form.id, { expectedVersion: version, student: { ...form, firstName: "Anne" } });
    assert.equal(saved.kind, "ok");
    assert.equal(saved.kind === "ok" && saved.student.firstName, "Anne");
    assert.equal((await updateStudentDetail(db, form.id, { expectedVersion: version, student: form })).kind, "conflict");
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: form.id } })).firstName, "Anne");
    const current = await db.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    const noOp = await updateStudentDetail(db, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Anne" } });
    assert.equal(noOp.kind === "ok" && noOp.changed, false);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: form.id } })).updatedAt.toISOString(), current.updatedAt.toISOString());
    const invalid = await updateStudentDetail(db, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Changed", section: "missing" } });
    assert.equal(invalid.kind, "invalid-groups");
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: form.id } })).firstName, "Anne");
    await db.$executeRawUnsafe("CREATE TRIGGER fail_section_connect BEFORE INSERT ON _GroupToStudent WHEN NEW.A = 'sec-b' BEGIN SELECT RAISE(ABORT, 'blocked relation write'); END");
    await assert.rejects(updateStudentDetail(db, form.id, { expectedVersion: studentEditVersion(current), student: { ...form, firstName: "Failed", section: "sec-b" } }));
    await db.$executeRawUnsafe("DROP TRIGGER fail_section_connect");
    const afterRollback = await db.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    assert.equal(afterRollback.firstName, "Anne");
    assert.deepEqual(afterRollback.groups.map(group => group.id).sort(), current.groups.map(group => group.id).sort());
    await db.group.update({ where: { id: "sec-b" }, data: { students: { connect: { id: form.id } } } });
    const ambiguous = await db.student.findUniqueOrThrow({ where: { id: form.id }, include: { groups: true } });
    assert.equal(ambiguous.updatedAt.toISOString(), current.updatedAt.toISOString());
    assert.notEqual(studentEditVersion(ambiguous), studentEditVersion(current));
    assert.equal((await updateStudentDetail(db, form.id, { expectedVersion: studentEditVersion(ambiguous), student: form })).kind, "group-review");
    await db.student.delete({ where: { id: form.id } });
    assert.equal((await updateStudentDetail(db, form.id, { expectedVersion: version, student: form })).kind, "not-found");
    assert.equal(await db.student.count(), 0);
  } finally {
    await db.$disconnect();
    rmSync(scratch, { recursive: true, force: true });
  }
});
