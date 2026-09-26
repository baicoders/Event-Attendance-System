/** Disposable end-to-end API fixture. Run after `npm run build` with `node scripts/test-student-history.mjs`. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const scratch = mkdtempSync(join(tmpdir(), "student-history-"));
const dbUrl = `file:${join(scratch, "history.db")}`;
const env = { ...process.env, DATABASE_URL: dbUrl, AUTH_SECRET: "student-history-disposable-test-secret", NODE_ENV: "production" };
let server;
let prisma;
let chrome;
const day = 86_400_000;
const schoolDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const schoolMidnight = date => new Date(`${date}T00:00:00+08:00`);
const port = await new Promise(resolve => { const listener = createServer(); listener.listen(0, "127.0.0.1", () => { const value = listener.address().port; listener.close(() => resolve(value)); }); });
const origin = `http://127.0.0.1:${port}`;

async function request(path, cookie) {
  const response = await fetch(`${origin}${path}`, { headers: cookie ? { Cookie: cookie } : undefined });
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
}

async function browserCheck(cookie) {
  const profile = join(scratch, "chrome");
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 80 && !existsSync(portFile); i++) await delay(100);
  if (!existsSync(portFile)) throw new Error("Chrome DevTools port did not open");
  const chromePort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message)); else waiting.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    const state = await evaluate('({url:location.href,active:document.activeElement?.outerHTML,dialog:document.querySelector("[role=dialog]")?.outerHTML?.slice(0,500),body:document.body.innerText.slice(0,500)})');
    throw new Error(`Browser condition timed out: ${expression}; state=${JSON.stringify(state)}`);
  };
  try {
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    const delimiter = cookie.indexOf("=");
    await command("Network.setCookie", { name: cookie.slice(0, delimiter), value: cookie.slice(delimiter + 1), url: origin });
    await command("Page.navigate", { url: `${origin}/students/student-list?category=ALL` });
    const button = 'document.querySelector(\'button[aria-label="Attendance history for 00000123456"]\')';
    await until(`${button} !== null`);
    await evaluate(`${button}.focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("Recorded participation")');
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("3 recorded time-ins")');
    await evaluate('document.querySelector(\'[role=tab][aria-selected="false"]\').click()');
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("not a historical enrollment record")');
    const width = await evaluate('document.querySelector("[role=dialog]").getBoundingClientRect().width');
    assert.ok(width <= 375, `Sheet width ${width}px exceeds 375px viewport`);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(tmpdir(), "student-history-mobile.png"), Buffer.from(screenshot.data, "base64"));
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until('document.querySelector("[role=dialog]") === null');
    console.log("Browser fixture passed: keyboard opens/closes history, comparison warning renders, and Sheet fits 375px. Screenshot: /tmp/student-history-mobile.png");
  } finally { ws.close(); }
}

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });
  const today = schoolDate();
  const todayStart = schoolMidnight(today);
  const past = offset => new Date(todayStart.getTime() - offset * day + 8 * 60 * 60_000);
  const end = offset => new Date(past(offset).getTime() + 4 * 60 * 60_000);
  await prisma.user.create({ data: { id: "admin", name: "Admin", email: "admin@example.test", password: "fixture-password-123", role: "ADMIN", status: "ACTIVE" } });
  await prisma.user.create({ data: { id: "other", name: "Other", email: "other@example.test", password: "fixture-password-123", role: "ORGANIZER", status: "ACTIVE" } });
  await prisma.group.create({ data: { id: "ga", name: "Section A", slug: "section-a", category: "SECTION" } });
  await prisma.group.create({ data: { id: "gb", name: "Section B", slug: "section-b", category: "SECTION" } });
  await prisma.student.create({ data: { id: "00000123456", firstName: "Ana", lastName: "Lee", schoolLevel: "COLLEGE", yearLevel: "YEAR_2", groups: { connect: { id: "ga" } } } });
  for (const [id, offset, group, status] of [
    ["present", 4, "ga", "APPROVED"], ["late", 3, "ga", "APPROVED"],
    ["missing", 2, "ga", "APPROVED"], ["incomplete", 1, "ga", "APPROVED"],
    ["outside", 1, "gb", "APPROVED"], ["hidden-draft", 1, "ga", "DRAFT"],
  ]) {
    await prisma.event.create({ data: { id, title: id, category: "SECTION", status,
      start: past(offset), end: end(offset), includedGroups: { connect: { id: group } }, createdById: "other" } });
  }
  for (const [id, eventId, timein] of [
    ["r1", "present", past(4)], ["r2", "late", new Date(past(3).getTime() + 30 * 60_000)],
    ["r3", "incomplete", null], ["r4", "outside", past(1)], ["r5", "hidden-draft", past(1)],
  ]) await prisma.record.create({ data: { id, eventId, studentId: "00000123456", method: "SCANNED", timein } });

  server = spawn("npm", ["run", "start", "--", "-p", String(port)], { env, stdio: "pipe", detached: true });
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Next server exited: ${server.exitCode}`);
    try { await fetch(`${origin}/api/auth/session`); break; } catch { await delay(250); }
  }
  const path = `/api/students/00000123456/attendance-history?from=${new Date(todayStart.getTime() - 5 * day).toISOString().slice(0, 10)}&to=${today}`;
  assert.equal((await request(path)).status, 401);
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: "fixture-password-123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const recorded = await request(path, cookie);
  assert.equal(recorded.status, 200);
  assert.equal(recorded.cache, "private, no-store");
  assert.equal(recorded.body.data.summary.recordedTimeIns, 3);
  assert.equal(recorded.body.data.summary.comparisonEvents, 4);
  assert.equal(recorded.body.data.summary.comparisonRatePercent, 50);
  assert.equal(recorded.body.data.rows.some(row => row.title === "hidden-draft"), false);
  assert.equal(recorded.body.data.rows.find(row => row.eventId === "outside").currentlyEligible, false);
  const comparison = await request(`${path}&view=current-roster&outcome=missing`, cookie);
  assert.equal(comparison.body.data.rowCount, 2);
  assert.equal((await request(`${path}&outcome=bogus`, cookie)).status, 400);
  assert.equal((await request(`/api/students/unknown/attendance-history`, cookie)).status, 404);
  const organizerLogin = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "other@example.test", password: "fixture-password-123" }) });
  assert.equal(organizerLogin.status, 200);
  const organizerCookie = organizerLogin.headers.get("set-cookie")?.split(";")[0];
  assert.ok(organizerCookie);
  const organizerView = await request(path, organizerCookie);
  assert.equal(organizerView.status, 200);
  assert.equal(organizerView.body.data.rows.some(row => row.title === "hidden-draft"), false);
  await prisma.user.update({ where: { id: "other" }, data: { status: "PENDING" } });
  assert.equal((await request(path, organizerCookie)).status, 403);
  await prisma.student.update({ where: { id: "00000123456" }, data: { groups: { set: [{ id: "gb" }] } } });
  const changedRoster = await request(path, cookie);
  assert.equal(changedRoster.body.data.summary.recordedTimeIns, 3);
  assert.equal(changedRoster.body.data.summary.comparisonEvents, 1);
  await prisma.student.update({ where: { id: "00000123456" }, data: { groups: { set: [{ id: "ga" }] } } });
  if (process.argv.includes("--browser")) await browserCheck(cookie);
  if (process.argv.includes("--large")) {
    await prisma.student.createMany({ data: Array.from({ length: 1999 }, (_, index) => ({
      id: `fixture-${String(index).padStart(5, "0")}`, firstName: "Fixture", lastName: "Student",
      schoolLevel: "COLLEGE", yearLevel: "YEAR_2",
    })) });
    await prisma.event.createMany({ data: Array.from({ length: 995 }, (_, index) => ({
      id: `large-${String(index).padStart(4, "0")}`, title: `Large fixture ${index}`,
      category: "ALL", status: "APPROVED", start: past(1), end: end(1),
    })) });
    const benchmarkPath = `${path}&view=current-roster&pageSize=25`;
    const warm = await request(benchmarkPath, cookie);
    assert.equal(warm.status, 200);
    assert.equal(warm.body.data.summary.comparisonEvents, 999);
    const samples = [];
    const scanSamples = [];
    for (let batch = 0; batch < 5; batch++) {
      const scan = (async () => {
        const start = performance.now();
        const response = await fetch(`${origin}/api/records`, { method: "POST", headers: {
          Cookie: cookie, "Content-Type": "application/json",
        }, body: JSON.stringify({ eventId: "large-0000", studentId: `fixture-${String(batch).padStart(5, "0")}`, method: "SCANNED" }) });
        assert.equal(response.status, 201);
        scanSamples.push(performance.now() - start);
      })();
      const timings = await Promise.all(Array.from({ length: 4 }, async () => {
        const start = performance.now();
        const response = await request(benchmarkPath, cookie);
        assert.equal(response.status, 200);
        return performance.now() - start;
      }));
      await scan;
      samples.push(...timings);
    }
    samples.sort((a, b) => a - b);
    console.log(`Large fixture: 2,000 students, 1,000 candidate events, 20 history requests at concurrency 4 plus 5 scans; 25-row payload ${Buffer.byteLength(JSON.stringify(warm.body))} bytes; history p50 ${samples[9].toFixed(1)} ms, p95 ${samples[18].toFixed(1)} ms; scan max ${Math.max(...scanSamples).toFixed(1)} ms.`);
    await prisma.event.create({ data: { id: "overflow", title: "Overflow", category: "ALL", status: "APPROVED", start: past(1), end: end(1) } });
    const overflow = await request(path, cookie);
    assert.equal(overflow.status, 422);
    assert.equal(overflow.body.code, "HISTORY_RANGE_TOO_LARGE");
  }
  console.log("Student history API fixture passed: auth, visibility, counts, outside-scope record, filters, validation, and missing student.");
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already exited */ }
  }
  if (chrome?.pid) {
    try { process.kill(-chrome.pid, "SIGTERM"); } catch { /* already exited */ }
  }
  await prisma?.$disconnect();
  await delay(500);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { console.warn(`Could not remove temporary fixture ${scratch}: ${error.message}`); }
}
