/** Run against a disposable PostgreSQL test database and a running dev server. See docs below. */
import assert from "node:assert/strict";
import { prisma } from "@/globals/libs/prisma";

function assertDisposablePostgresDatabase() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  let dbName = "";
  try {
    dbName = new URL(dbUrl).pathname.replace(/^\//, "").split("/")[0] ?? "";
  } catch {
    dbName = "";
  }
  if (
    !dbUrl.startsWith("postgresql://") ||
    !/^test_[a-z0-9_]+$/.test(dbName) ||
    ["event_attendance_dev", "event_attendance_prod"].includes(dbName)
  ) {
    throw new Error("Use a disposable PostgreSQL test database (postgresql://.../test_<name>). Refusing dev/prod databases.");
  }
}

async function main() {
assertDisposablePostgresDatabase();

const base = process.env.AUDIENCE_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const prefix = `issue67-${Date.now()}`;
const admin = await prisma.user.create({ data: {
  name: "Audience Admin", email: `${prefix}-admin@example.test`, password: "password123", role: "ADMIN", status: "ACTIVE",
} });
const owner = await prisma.user.create({ data: {
  name: "Audience Owner", email: `${prefix}-owner@example.test`, password: "password123", role: "ORGANIZER", status: "ACTIVE",
} });
const other = await prisma.user.create({ data: {
  name: "Audience Other", email: `${prefix}-other@example.test`, password: "password123", role: "ORGANIZER", status: "ACTIVE",
} });
const inactive = await prisma.user.create({ data: {
  name: "Audience Inactive", email: `${prefix}-inactive@example.test`, password: "password123", role: "ORGANIZER", status: "REJECTED",
} });
const cs = await prisma.group.create({ data: { name: "Computer Studies", slug: `${prefix}-cs`, category: "DEPARTMENT" } });
const business = await prisma.group.create({ data: { name: "Business", slug: `${prefix}-business`, category: "DEPARTMENT" } });
const house = await prisma.group.create({ data: { name: "Blue", slug: `${prefix}-blue`, category: "HOUSE" } });
const year = await prisma.group.create({ data: { name: "Year 2", slug: `${prefix}-year2`, category: "YEAR" } });
const program = await prisma.group.create({ data: { name: "BSIT", slug: `${prefix}-bsit`, category: "PROGRAM" } });
const section = await prisma.group.create({ data: { name: "BSIT-2A", slug: `${prefix}-bsit2a`, category: "SECTION" } });
const strand = await prisma.group.create({ data: { name: "STEM", slug: `${prefix}-stem`, category: "STRAND" } });
const students = [
  { id: "00000123456", firstName: "Juan", lastName: "Dela Cruz", schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_2" as const, groups: { connect: [{ id: cs.id }, { id: business.id }, { id: house.id }, { id: program.id }, { id: section.id }] } },
  { id: "00000123457", firstName: "Ana", lastName: "Santos", schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_1" as const, groups: { connect: [{ id: business.id }] } },
  { id: "00000123458", firstName: "Rosa", lastName: "Cruz", schoolLevel: "SHS" as const, yearLevel: "GRADE_11" as const, groups: { connect: [{ id: strand.id }] } },
];
for (const student of students) await prisma.student.upsert({ where: { id: student.id }, update: student, create: student });
const event = await prisma.event.create({ data: {
  title: "Audience fixture", category: "DEPARTMENT", includedGroups: { connect: [{ id: cs.id }, { id: business.id }] },
  start: new Date(), end: new Date(Date.now() + 3600000), status: "APPROVED", createdById: owner.id,
} });
const draft = await prisma.event.create({ data: {
  title: "Draft audience fixture", category: "ALL", start: new Date(), end: new Date(Date.now() + 3600000), createdById: owner.id,
} });

async function login(email: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
  assert.equal(response.status, 200, await response.text());
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function preview(cookie: string | undefined, payload: Record<string, unknown>) {
  const response = await fetch(`${base}/api/events/audience-preview`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() as { success: boolean; data?: { totalEligible: number; searchMatches: number; students: { id: string }[]; limitation?: string } } };
}

const ownerCookie = await login(owner.email);
const otherCookie = await login(other.email);
const adminCookie = await login(admin.email);
const all = await preview(ownerCookie, { category: "ALL", includedGroups: [] });
assert.equal(all.body.data?.totalEligible, 3);
assert.equal((await preview(ownerCookie, { category: "COLLEGE", includedGroups: [] })).body.data?.totalEligible, 2);
assert.equal((await preview(ownerCookie, { category: "SHS", includedGroups: [] })).body.data?.totalEligible, 1);
for (const [category, groupId] of [["HOUSE", house.id], ["PROGRAM", program.id], ["SECTION", section.id], ["STRAND", strand.id]]) {
  assert.equal((await preview(ownerCookie, { category, includedGroups: [groupId] })).body.data?.totalEligible, 1);
}
const union = await preview(ownerCookie, { category: "DEPARTMENT", includedGroups: [cs.id, business.id, cs.id], includeRoster: true, pageSize: 1 });
assert.equal(union.body.data?.totalEligible, 2);
assert.equal(union.body.data?.students.length, 1);
assert.equal(union.body.data?.students[0].id, "00000123456");
const secondPage = await preview(ownerCookie, { category: "DEPARTMENT", includedGroups: [cs.id, business.id], includeRoster: true, pageSize: 1, page: 2 });
assert.equal(secondPage.body.data?.students[0].id, "00000123457");
const emptyPage = await preview(ownerCookie, { category: "DEPARTMENT", includedGroups: [cs.id, business.id], includeRoster: true, pageSize: 1, page: 3 });
assert.equal(emptyPage.body.data?.searchMatches, 2);
assert.deepEqual(emptyPage.body.data?.students, []);
const searched = await preview(ownerCookie, { category: "DEPARTMENT", includedGroups: [cs.id, business.id], includeRoster: true, search: "00000123457" });
assert.equal(searched.body.data?.totalEligible, 2);
assert.equal(searched.body.data?.searchMatches, 1);
assert.equal(searched.body.data?.students[0].id, "00000123457");
assert.equal((await preview(ownerCookie, { category: "YEAR", includedGroups: [year.id] })).body.data?.totalEligible, 0);
assert.ok((await preview(ownerCookie, { category: "YEAR", includedGroups: [year.id] })).body.data?.limitation);
for (const payload of [
  { category: "DEPARTMENT", includedGroups: [] },
  { category: "DEPARTMENT", includedGroups: ["missing"] },
  { category: "DEPARTMENT", includedGroups: [house.id] },
  { category: "ALL", includedGroups: [], pageSize: 101 },
  { category: "ALL", includedGroups: [], search: "x".repeat(101) },
]) assert.equal((await preview(ownerCookie, payload)).status, 400);
assert.equal((await preview(undefined, { category: "ALL", includedGroups: [] })).status, 401);
const inactiveLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inactive.email, password: "password123" }) });
assert.equal(inactiveLogin.status, 403);
assert.equal((await preview(ownerCookie, { category: "ALL", includedGroups: [], eventId: draft.id })).status, 200);
assert.equal((await preview(otherCookie, { category: "ALL", includedGroups: [], eventId: event.id })).status, 403);
assert.equal((await preview(otherCookie, { category: "ALL", includedGroups: [], eventId: draft.id })).status, 403);
assert.equal((await preview(ownerCookie, { category: "ALL", includedGroups: [], eventId: event.id })).status, 409);
assert.equal((await preview(adminCookie, { category: "ALL", includedGroups: [], eventId: event.id })).status, 200);
const response = await fetch(`${base}/api/students?eventId=${event.id}`, { headers: { Cookie: ownerCookie } });
assert.equal(response.status, 200);
const eventStudents = (await response.json() as { data: { id: string }[] }).data;
assert.deepEqual(eventStudents.map((s) => s.id).sort(), ["00000123456", "00000123457"]);
for (const [category, groupIds] of [
  ["ALL", []], ["COLLEGE", []], ["SHS", []],
  ["DEPARTMENT", [cs.id, business.id]], ["HOUSE", [house.id]],
  ["STRAND", [strand.id]], ["PROGRAM", [program.id]],
  ["SECTION", [section.id]], ["YEAR", [year.id]],
] as const) {
  const audience = await preview(ownerCookie, { category, includedGroups: groupIds, includeRoster: true });
  assert.equal(audience.status, 200);
  const eligibleIds = audience.body.data!.students.map((student) => student.id).sort();
  const saved = await prisma.event.create({ data: {
    title: `Eligibility ${category}`, category,
    includedGroups: { connect: groupIds.map((id) => ({ id })) },
    start: new Date(), end: new Date(Date.now() + 3600000),
    status: "APPROVED", createdById: owner.id,
  } });
  const rosterResponse = await fetch(`${base}/api/students?eventId=${saved.id}`, { headers: { Cookie: ownerCookie } });
  assert.equal(rosterResponse.status, 200);
  const rosterIds = (await rosterResponse.json() as { data: { id: string }[] }).data.map((student) => student.id).sort();
  assert.deepEqual(rosterIds, eligibleIds, `${category} preview and saved roster differ`);
  for (const student of students) {
    const recordResponse = await fetch(`${base}/api/records`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ eventId: saved.id, studentId: student.id, method: "MANUAL" }),
    });
    assert.equal(recordResponse.status, eligibleIds.includes(student.id) ? 201 : 404,
      `${category} attendance gate disagrees for ${student.id}`);
  }
}
await prisma.student.create({ data: {
  id: "00000123459", firstName: "New", lastName: "Import", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
} });
assert.equal((await preview(ownerCookie, { category: "ALL", includedGroups: [] })).body.data?.totalEligible, 4);
await prisma.user.update({ where: { id: owner.id }, data: { status: "REJECTED" } });
assert.equal((await preview(ownerCookie, { category: "ALL", includedGroups: [] })).status, 403);
await prisma.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
console.log("Audience preview API fixture passed: all categories agree with saved rosters and attendance; validation, search, pagination, YEAR, and auth covered.");
await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
