import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { createDisposableDb, createTestClient } from "../libs/testDb";
import { takeRosterExclusiveLock } from "./pgLocks";

test("group deletion uses the roster state after queued writers commit", async t => {
  const fixture = await createDisposableDb("test_group_delete");
  const { db, disconnect } = createTestClient(fixture.url);
  const moduleRequire = createRequire(`${process.cwd()}/package.json`);
  const globalDb = globalThis as typeof globalThis & { prisma?: typeof db };
  const previousDb = globalDb.prisma;
  t.after(async () => {
    globalDb.prisma = previousDb;
    await disconnect();
    await fixture.cleanup();
  });
  globalDb.prisma = db;
  // Only replace the request-context auth boundary. The handler, validation,
  // Prisma adapter, transactions, advisory locks and database remain real.
  const authPath = moduleRequire.resolve(`${process.cwd()}/globals/utils/auth.ts`);
  const auth = moduleRequire(authPath);
  const authCache = moduleRequire.cache[authPath]!;
  const previousAuth = authCache.exports;
  authCache.exports = { ...auth, requireAuth: async () => ({ id: "fixture-admin", role: "ADMIN" }) };
  const { DELETE } = (() => {
    try {
      return moduleRequire(`${process.cwd()}/app/api/groups/[groupId]/route.ts`) as typeof import("../../app/api/groups/[groupId]/route");
    } finally {
      authCache.exports = previousAuth;
    }
  })();

  const remove = (id: string, reassignToGroupId?: string) => DELETE(new NextRequest(`http://localhost/api/groups/${id}`, {
    method: "DELETE", body: JSON.stringify({ reassignToGroupId }),
  }), { params: Promise.resolve({ groupId: id }) });

  async function deleteBehindWriter(id: string, target: string, mutate: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(resolve => { ready = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const writer = db.$transaction(async tx => {
      await takeRosterExclusiveLock(tx);
      ready();
      await resume;
      await mutate(tx);
    }, { timeout: 15_000 });
    await held;
    const deletion = remove(id, target);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.datname = current_database() AND l.locktype = 'advisory' AND NOT l.granted
          ) AS waiting`;
        if (rows[0].waiting) { waiting = true; break; }
        await delay(10);
      }
      assert.ok(waiting, "DELETE must be waiting behind the roster writer before its mutation");
    } finally {
      release();
      await writer;
    }
    return deletion;
  }

  await t.test("late source memberships are reassigned and counted", async () => {
    const source = await db.group.create({ data: { name: "Source", slug: "source", category: "SECTION" } });
    const target = await db.group.create({ data: { name: "Target", slug: "target", category: "SECTION" } });
    const prior = await db.student.create({ data: { firstName: "Prior", lastName: "Student", usn: "00000123456", groups: { connect: { id: source.id } } } });
    let lateId = "";
    const response = await deleteBehindWriter(source.id, target.id, async tx => {
      const late = await tx.student.create({ data: { firstName: "Late", lastName: "Student", lrn: "000000123456", groups: { connect: { id: source.id } } } });
      lateId = late.id;
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.reassignedStudents, 2);
    for (const id of [prior.id, lateId]) {
      const student = await db.student.findUniqueOrThrow({ where: { id }, include: { groups: true } });
      assert.deepEqual(student.groups.map(group => group.id), [target.id]);
    }
  });

  await t.test("late event references prevent deletion and preserve the audience", async () => {
    const source = await db.group.create({ data: { name: "Event source", slug: "event-source", category: "SECTION" } });
    const target = await db.group.create({ data: { name: "Event target", slug: "event-target", category: "SECTION" } });
    let eventId = "";
    const response = await deleteBehindWriter(source.id, target.id, async tx => {
      const event = await tx.event.create({ data: { title: "Late audience", category: "SECTION", start: new Date(), end: new Date(), includedGroups: { connect: { id: source.id } } } });
      eventId = event.id;
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "GROUP_IN_USE_BY_EVENTS");
    assert.ok(await db.group.findUnique({ where: { id: source.id } }));
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId }, include: { includedGroups: true } });
    assert.deepEqual(event.includedGroups.map(group => group.id), [source.id]);
  });

  await t.test("a replacement deleted by a preceding writer is rejected", async () => {
    const source = await db.group.create({ data: { name: "Surviving source", slug: "surviving-source", category: "HOUSE" } });
    const target = await db.group.create({ data: { name: "Removed target", slug: "removed-target", category: "HOUSE" } });
    const response = await deleteBehindWriter(source.id, target.id, tx => tx.group.delete({ where: { id: target.id } }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_TARGET");
    assert.ok(await db.group.findUnique({ where: { id: source.id } }));
  });

  await t.test("a source deleted by a preceding writer returns not found", async () => {
    const source = await db.group.create({ data: { name: "Removed source", slug: "removed-source", category: "HOUSE" } });
    const target = await db.group.create({ data: { name: "Surviving target", slug: "surviving-target", category: "HOUSE" } });
    const response = await deleteBehindWriter(source.id, target.id, tx => tx.group.delete({ where: { id: source.id } }));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "NOT_FOUND");
    assert.ok(await db.group.findUnique({ where: { id: target.id } }));
  });

  await t.test("self and cross-category replacements preserve the original membership", async () => {
    const source = await db.group.create({ data: { name: "Valid source", slug: "valid-source", category: "HOUSE" } });
    const target = await db.group.create({ data: { name: "Wrong category", slug: "wrong-category", category: "SECTION" } });
    const student = await db.student.create({ data: { firstName: "Unchanged", lastName: "Student", lrn: "000000123457", groups: { connect: { id: source.id } } } });
    for (const replacement of [source.id, target.id]) {
      const response = await remove(source.id, replacement);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_TARGET");
      const retained = await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { groups: true } });
      assert.deepEqual(retained.groups.map(group => group.id), [source.id]);
    }
  });

  await t.test("deletion without a replacement preserves students and reports unassignments", async () => {
    const source = await db.group.create({ data: { name: "Unassigned source", slug: "unassigned-source", category: "HOUSE" } });
    const student = await db.student.create({ data: { firstName: "Retained", lastName: "Student", lrn: "000000123458", groups: { connect: { id: source.id } } } });
    const response = await remove(source.id);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { id: source.id, reassignedStudents: 0, unassignedStudents: 1 });
    const retained = await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { groups: true } });
    assert.deepEqual(retained.groups, []);
  });

  await t.test("employee classification cannot be deleted or used as a replacement", async () => {
    const employees = await db.group.create({ data: { name: "Employees", slug: "employees", category: "SECTION" } });
    const source = await db.group.create({ data: { name: "Ordinary section", slug: "ordinary-section", category: "SECTION" } });
    assert.equal((await remove(employees.id)).status, 409);
    assert.equal((await remove(source.id, employees.id)).status, 400);
    assert.ok(await db.group.findUnique({ where: { id: employees.id } }));
    assert.ok(await db.group.findUnique({ where: { id: source.id } }));
  });
});
