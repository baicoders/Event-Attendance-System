/** HTTP fixture for #74. Run with a disposable PostgreSQL test database and a local server. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { prisma } from "@/globals/libs/prisma";
import { eventExportSchema } from "@/features/reports/utils/eventExport";
import { serializeCsv } from "@/globals/utils/csvExport";

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
  await prisma.record.deleteMany();
  await prisma.event.deleteMany();
  await prisma.student.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
  const base = process.env.EXPORT_TEST_BASE_URL ?? "http://127.0.0.1:3112";
  const prefix = `issue74-${Date.now()}`;
  const user = async (name: string, role: "ADMIN" | "ORGANIZER", status: "ACTIVE" | "REJECTED" = "ACTIVE") => prisma.user.create({ data: { name, email: `${prefix}-${name.toLowerCase()}@example.test`, password: "password123", role, status } });
  const owner = await user("Owner", "ORGANIZER");
  const other = await user("Other", "ORGANIZER");
  const admin = await user("Admin", "ADMIN");
  const inactive = await user("Inactive", "ORGANIZER", "REJECTED");
  const section = await prisma.group.create({ data: { name: "Ungrouped", slug: `${prefix}-section`, category: "SECTION" } });
  const secondSection = await prisma.group.create({ data: { name: "Ungrouped", slug: `${prefix}-section-2`, category: "SECTION" } });
  for (let index = 1; index <= 5; index++) {
    await prisma.student.create({ data: {
      id: `0000000000${index}`, firstName: `Student ${index}`, lastName: "Test", schoolLevel: index === 5 ? "SHS" : "COLLEGE", yearLevel: index === 5 ? "GRADE_11" : "YEAR_1",
      groups: index === 1 ? { connect: [{ id: section.id }] } : index === 2 ? { connect: [{ id: secondSection.id }] } : index === 3 ? { connect: [{ id: section.id }, { id: secondSection.id }] } : undefined,
    } });
  }
  const start = new Date("2026-09-25T08:00:00.000Z");
  const event = await prisma.event.create({ data: { title: "Export, fixture", category: "COLLEGE", status: "APPROVED", start, end: new Date(start.getTime() + 3600000), createdById: owner.id } });
  const draft = await prisma.event.create({ data: { title: "Draft fixture", category: "COLLEGE", start, end: new Date(start.getTime() + 3600000), createdById: owner.id } });
  await prisma.record.create({ data: { eventId: event.id, studentId: "00000000001", method: "SCANNED", timein: new Date("2026-09-25T08:00:00.000Z") } });
  await prisma.record.create({ data: { eventId: event.id, studentId: "00000000002", method: "MANUAL", timein: new Date("2026-09-25T08:30:00.000Z") } });
  await prisma.record.create({ data: { eventId: event.id, studentId: "00000000004", method: "MANUAL" } });
  await prisma.record.create({ data: { eventId: event.id, studentId: "00000000005", method: "MANUAL", timein: start } });

  async function login(email: string) {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  const ownerCookie = await login(owner.email);
  const otherCookie = await login(other.email);
  const adminCookie = await login(admin.email);
  async function request(id: string, query: string, cookie?: string) {
    return fetch(`${base}/api/reports/events/${id}/export?${query}`, { headers: cookie ? { Cookie: cookie } : {} });
  }
  assert.equal((await request(event.id, "preset=full")).status, 401);
  assert.equal((await request(draft.id, "preset=full", otherCookie)).status, 403);
  assert.equal((await request(event.id, "preset=full", otherCookie)).status, 200);
  assert.equal((await request(draft.id, "preset=full", adminCookie)).status, 200);
  assert.equal((await request(event.id, "preset=full&page=1", ownerCookie)).status, 400);
  assert.equal((await request(event.id, "preset=full&groupBy=SECTION", ownerCookie)).status, 400);
  assert.equal((await request(event.id, "preset=full&preset=late", ownerCookie)).status, 400);
  assert.equal((await fetch(`${base}/reports/events/${event.id}/print?view=summary&groupBy=YEAR&groupBy=SECTION`, { headers: { Cookie: ownerCookie } })).status, 404);
  for (const [preset, count] of [["full", 4], ["absent", 2], ["late", 1], ["times", 3]] as const) {
    const response = await request(event.id, `preset=${preset}`, ownerCookie);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const json = JSON.parse(body);
    const parsed = eventExportSchema.parse(json.data);
    assert.equal(parsed.rowCount, count);
    assert.equal(parsed.totals.attended, 2);
    assert.equal(parsed.totals.eligible, 4);
    assert.equal(parsed.totals.rate, 50);
    assert.ok(!JSON.stringify(parsed).includes("password123"));
    const csv = serializeCsv(parsed.columns.map((column) => column.label), parsed.rows);
    if (preset === "full") await writeFile("/tmp/issue74-full.csv", csv);
    assert.ok(csv.includes(preset === "late" ? "00000000002" : preset === "absent" ? "00000000003" : "00000000001"));
    assert.ok(!csv.includes("[object Object]"));
  }
  const groupResponse = await request(event.id, "preset=groups&groupBy=SECTION", ownerCookie);
  const grouped = eventExportSchema.parse((await groupResponse.json()).data);
  assert.equal(grouped.rows.at(-1)?.["Row type"], "TOTAL");
  assert.equal(grouped.rows.filter((row) => row["Row type"] === "GROUP").reduce((sum, row) => sum + Number(row.Eligible), 0), 4);
  assert.deepEqual(grouped.rows.filter((row) => row["Row type"] === "GROUP").map((row) => row["Bucket key"]), [`g:${section.id}`, `g:${secondSection.id}`, "none", "multiple"]);
  const print = await fetch(`${base}/reports/events/${event.id}/print?view=summary&groupBy=SECTION`, { headers: { Cookie: ownerCookie } });
  assert.equal(print.status, 200);
  const html = await print.text();
  assert.ok(html.includes("Event Attendance Summary"));
  assert.ok(!html.includes("00000000001"));
  assert.equal((await fetch(`${base}/reports/events/${draft.id}/print?view=summary`, { headers: { Cookie: otherCookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inactive.email, password: "password123" }) })).status, 403);
  await prisma.user.update({ where: { id: owner.id }, data: { status: "REJECTED" } });
  assert.equal((await request(event.id, "preset=full", ownerCookie)).status, 403);
  await prisma.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
  console.log("Event export HTTP fixture passed: presets, cohorts, groups, CSV, permissions, print, and validation.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
