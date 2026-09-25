/** Synthetic 2,000-student/five-operator export probe on a disposable #74 DB. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { prisma } from "@/globals/libs/prisma";
import { eventExportSchema } from "@/features/reports/utils/eventExport";

async function main() {
  if (!/^file:\/tmp\/issue74-export-[a-z-]+\.db$/.test(process.env.DATABASE_URL ?? "")) throw new Error("Use the disposable #74 fixture database.");
  const base = process.env.EXPORT_TEST_BASE_URL ?? "http://127.0.0.1:3112";
  const owner = await prisma.user.findFirst({ where: { name: "Owner" }, orderBy: { createdAt: "desc" } });
  assert.ok(owner);
  const current = await prisma.student.count({ where: { schoolLevel: "COLLEGE" } });
  const missing = Math.max(0, 2000 - current);
  for (let offset = 0; offset < missing; offset += 400) {
    await prisma.student.createMany({ data: Array.from({ length: Math.min(400, missing - offset) }, (_, index) => ({
      id: String(20000000000 + offset + index), firstName: "Bench", lastName: `Student ${offset + index}`, schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_1" as const,
    })) });
  }
  const event = await prisma.event.create({ data: { title: "2000 roster export probe", category: "COLLEGE", status: "APPROVED", start: new Date(), end: new Date(Date.now() + 3600000), createdById: owner.id } });
  const others = await prisma.user.findMany({ where: { name: { in: ["Other", "Admin"] } } });
  const operators = [owner, ...others];
  for (let index = operators.length; index < 5; index++) operators.push(await prisma.user.create({ data: { name: `Probe ${index}`, email: `issue74-probe-${Date.now()}-${index}@example.test`, password: "password123", role: "ORGANIZER", status: "ACTIVE" } }));
  const cookies = await Promise.all(operators.map(async (operator) => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: operator.email, password: "password123" }) });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get("set-cookie")!.split(";")[0];
  }));
  const exportUrl = `${base}/api/reports/events/${event.id}/export?preset=full`;
  const requests = cookies.map(async (cookie) => {
    const start = performance.now();
    const response = await fetch(exportUrl, { headers: { Cookie: cookie } });
    const body = await response.text();
    const elapsedMs = Math.round(performance.now() - start);
    assert.equal(response.status, 200, body.slice(0, 200));
    const prepared = eventExportSchema.parse(JSON.parse(body).data);
    assert.equal(prepared.rowCount, 2000);
    assert.equal(prepared.totals.eligible, 2000);
    assert.equal(prepared.totals.attended + prepared.totals.absent, 2000);
    return { elapsedMs, bytes: Buffer.byteLength(body, "utf8"), attended: prepared.totals.attended };
  });
  const studentId = String(20000000000);
  const scanStart = performance.now();
  const write = fetch(`${base}/api/records`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies[0] }, body: JSON.stringify({ eventId: event.id, studentId, method: "MANUAL" }) });
  const [results, scan] = await Promise.all([Promise.all(requests), write]);
  const scanMs = Math.round(performance.now() - scanStart);
  assert.equal(scan.status, 201, await scan.text());
  console.log(JSON.stringify({ sourceStudents: 2000, concurrentOperators: 5, exports: results, recordWriteMs: scanMs, queryCount: "not instrumented" }));
  if (process.env.EXPORT_TEST_LIMIT === "1") {
    for (let offset = 0; offset < 8001; offset += 400) {
      await prisma.student.createMany({ data: Array.from({ length: Math.min(400, 8001 - offset) }, (_, index) => ({
        id: String(30000000000 + offset + index), firstName: "Limit", lastName: `Student ${offset + index}`, schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_1" as const,
      })) });
    }
    const oversized = await fetch(exportUrl, { headers: { Cookie: cookies[0], Connection: "close" } });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, "EXPORT_TOO_LARGE");
    console.log("10,001-student source audience rejected with 413 EXPORT_TOO_LARGE.");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
