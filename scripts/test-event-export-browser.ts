/** Local Chrome smoke check for #74 after scripts/test-event-export.ts. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

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
  const base = "http://127.0.0.1:3112";
  const owner = await prisma.user.findFirst({ where: { name: "Owner" }, orderBy: { createdAt: "desc" } });
  const event = await prisma.event.findFirst({ where: { title: "Export, fixture" }, orderBy: { createdAt: "desc" } });
  assert.ok(owner && event);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: owner.email, password: "password123" }) });
  assert.equal(login.status, 200);
  const [name, value] = login.headers.get("set-cookie")!.split(";")[0].split("=");
  const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json() as { type: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((item) => item.type === "page");
  assert.ok(target);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(message.error); else entry.resolve(message.result);
  });
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const result = await send<{ result: { value: unknown } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result.result.value;
  };
  const waitFor = async (expression: string) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${expression}: ${String(await evaluate("document.body.innerText.slice(0, 1000)"))}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCookie", { name, value, url: base, httpOnly: true, sameSite: "Lax" });
  await send("Page.navigate", { url: `${base}/reports/events/${event.id}` });
  await waitFor("Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Export')");
  await evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Export')?.click()");
  await waitFor("document.body.innerText.includes('Export event data') && document.body.innerText.includes('Download CSV — 4 rows')");
  assert.ok(String(await evaluate("document.body.innerText")).includes("Report-page filters"));
  await evaluate("document.querySelector('input[value=\"late\"]')?.click()");
  await waitFor("document.body.innerText.includes('Download CSV — 1 rows')");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile("/tmp/issue74-export-mobile.png", Buffer.from(mobile.data, "base64"));
  await send("Emulation.clearDeviceMetricsOverride");
  await send("Page.navigate", { url: `${base}/reports/events/${event.id}/print?view=summary&groupBy=SECTION` });
  await waitFor("document.body.innerText.includes('EVENT ATTENDANCE SUMMARY')");
  assert.equal(String(await evaluate("document.body.innerText")).includes("00000000001"), false);
  const pdf = await send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  await writeFile("/tmp/issue74-summary.pdf", Buffer.from(pdf.data, "base64"));
  await send("Page.navigate", { url: `${base}/reports/events/${event.id}/print` });
  await waitFor("document.body.innerText.includes('EVENT ATTENDANCE SHEET')");
  assert.equal(String(await evaluate("document.body.innerText")).includes("00000000001"), true);
  await send("Page.navigate", { url: `${base}/attendance?eventId=${event.id}` });
  await waitFor(`Boolean(document.querySelector('a[href="/reports/events/${event.id}?export=1"]'))`);
  if (process.env.EXPORT_STRESS_PRINT === "1") {
    const stress = await prisma.event.create({ data: { title: "Long group print fixture", category: "ALL", status: "APPROVED", start: event.start, end: event.end, createdById: owner.id } });
    for (let index = 0; index < 80; index++) {
      const group = await prisma.group.create({ data: { name: `Very long section name for group ${index + 1}`, slug: `issue74-print-${Date.now()}-${index}`, category: "SECTION" } });
      await prisma.student.create({ data: { id: String(10000000000 + index), firstName: "Print", lastName: `Student ${index}`, schoolLevel: "COLLEGE", yearLevel: "YEAR_1", groups: { connect: [{ id: group.id }] } } });
    }
    await send("Page.navigate", { url: `${base}/reports/events/${stress.id}/print?view=summary&groupBy=SECTION` });
    await waitFor("document.body.innerText.includes('Long group print fixture') && document.body.innerText.includes('TOTAL')");
    const longPdf = await send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
    await writeFile("/tmp/issue74-summary-multipage.pdf", Buffer.from(longPdf.data, "base64"));
  }
  socket.close();
  console.log("Chrome report picker and print summary passed; mobile screenshot and PDF saved under /tmp/issue74-*.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
