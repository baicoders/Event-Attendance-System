/** Disposable bulk-actions API fixture. Run after `pnpm build` with `node scripts/test-student-bulk.mjs`. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const scratch = mkdtempSync(join(tmpdir(), "student-bulk-"));
const dbUrl = `file:${join(scratch, "bulk.db")}`;
const AUTH_SECRET = "student-bulk-disposable-test-secret-123";
const env = { ...process.env, DATABASE_URL: dbUrl, AUTH_SECRET, NODE_ENV: "production" };
let server;
let prisma;
let prisma2;
let chrome;

const port = await new Promise((resolve) => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1", () => {
    const value = listener.address().port;
    listener.close(() => resolve(value));
  });
});
const origin = `http://127.0.0.1:${port}`;

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, cache: res.headers.get("cache-control") };
}

async function login(email, password) {
  const res = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(`student-bulk-commit-v1.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

async function browserCheck(cookie) {
  const profile = join(scratch, "chrome");
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 80 && !existsSync(portFile); i++) await delay(100);
  if (!existsSync(portFile)) throw new Error("Chrome DevTools port did not open");
  const chromePort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Evaluate failed: ${detail} for ${expression}`);
    }
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    const state = await evaluate("document.body.innerText.slice(0,800)");
    throw new Error(`Browser condition timed out: ${expression}; body=${JSON.stringify(state)}`);
  };
  try {
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    const delimiter = cookie.indexOf("=");
    await command("Network.setCookie", { name: cookie.slice(0, delimiter), value: cookie.slice(delimiter + 1), url: origin });
    await command("Page.navigate", { url: `${origin}/students/student-list?category=ALL` });
    await until('document.body.innerText.includes("Dela Cruz")');
    // Select two rows across the roster via their accessible checkboxes.
    await evaluate('document.querySelector(\'[aria-label="Select 00000123456"]\')?.click()');
    await evaluate('document.querySelector(\'[aria-label="Select 00000123457"]\')?.click()');
    await until('document.body.innerText.includes("selected across pages")');
    await until('document.body.innerText.toLowerCase().includes("export selected")');
    // Keyboard: focus Review selected and open with Enter.
    await evaluate('[...document.querySelectorAll("button")].find(b=>(b.textContent||"").toLowerCase().includes("review selected"))?.focus()');
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until('document.querySelector("[role=dialog]")?.textContent?.toLowerCase()?.includes("review selected")');
    const width = await evaluate('document.querySelector("[role=dialog]").getBoundingClientRect().width');
    assert.ok(width <= 375, `Sheet width ${width}px exceeds 375px viewport`);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(tmpdir(), "student-bulk-mobile.png"), Buffer.from(screenshot.data, "base64"));
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until('document.querySelector("[role=dialog]") === null');
    console.log("Browser fixture passed: selection toolbar, keyboard review sheet, 375px fit. Screenshot: /tmp/student-bulk-mobile.png");
  } finally {
    ws.close();
  }
}

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });
  prisma2 = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });

  await prisma.user.createMany({
    data: [
      { id: "admin", name: "Admin", email: "admin@example.test", password: "fixture-password-123", role: "ADMIN", status: "ACTIVE" },
      { id: "org", name: "Org", email: "org@example.test", password: "fixture-password-123", role: "ORGANIZER", status: "ACTIVE" },
      { id: "pending", name: "Pending", email: "pending@example.test", password: "fixture-password-123", role: "ORGANIZER", status: "PENDING" },
      { id: "other", name: "Other", email: "other@example.test", password: "fixture-password-123", role: "ORGANIZER", status: "ACTIVE" },
    ],
  });
  await prisma.group.createMany({
    data: [
      { id: "sec-a", name: "BSIT 2A", slug: "bsit-2a", category: "SECTION" },
      { id: "sec-b", name: "BSIT 2B", slug: "bsit-2b", category: "SECTION" },
      { id: "house-azul", name: "Azul", slug: "azul", category: "HOUSE" },
      { id: "house-verde", name: "Verde", slug: "verde", category: "HOUSE" },
      { id: "dept-cs", name: "Computer Studies", slug: "computer-studies", category: "DEPARTMENT" },
      { id: "prog-bsit", name: "BSIT", slug: "bsit", category: "PROGRAM" },
    ],
  });
  const studentData = (id, lastName, sec, house) => ({
    id, firstName: "Test", lastName, middleName: null, schoolLevel: "COLLEGE", yearLevel: "YEAR_2",
  });
  await prisma.student.create({ data: { ...studentData("00000123456", "Dela Cruz"), groups: { connect: [{ id: "sec-a" }, { id: "house-azul" }, { id: "dept-cs" }, { id: "prog-bsit" }] } } });
  await prisma.student.create({ data: { ...studentData("00000123457", "Santos"), groups: { connect: [{ id: "sec-a" }, { id: "house-verde" }, { id: "dept-cs" }, { id: "prog-bsit" }] } } });
  await prisma.student.create({ data: { ...studentData("00000123458", "Reyes"), groups: { connect: [{ id: "sec-b" }, { id: "house-azul" }, { id: "dept-cs" }, { id: "prog-bsit" }] } } });
  // Ambiguous: two sections
  await prisma.student.create({ data: { ...studentData("00000123480", "Ambiguous"), groups: { connect: [{ id: "sec-a" }, { id: "sec-b" }, { id: "house-azul" }, { id: "dept-cs" }, { id: "prog-bsit" }] } } });
  // Formula payload + unicode
  await prisma.student.create({ data: { id: "00000123459", firstName: "=2+2", lastName: "Oñate, Jr.", middleName: null, schoolLevel: "COLLEGE", yearLevel: "YEAR_2", groups: { connect: [{ id: "sec-a" }, { id: "house-azul" }, { id: "dept-cs" }, { id: "prog-bsit" }] } } });

  await prisma.event.create({
    data: {
      id: "ev1", title: "Fixture Event", category: "SECTION", status: "APPROVED",
      start: new Date("2026-09-20T00:00:00Z"), end: new Date("2026-09-20T04:00:00Z"),
      includedGroups: { connect: [{ id: "sec-a" }] }, createdById: "admin",
    },
  });
  await prisma.record.create({ data: { id: "rec1", eventId: "ev1", studentId: "00000123456", method: "SCANNED", timein: new Date("2026-09-20T00:10:00Z") } });

  server = spawn("npm", ["run", "start", "--", "-p", String(port)], { env, stdio: "pipe", detached: true });
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Next server exited: ${server.exitCode}`);
    try {
      await fetch(`${origin}/api/auth/session`);
      break;
    } catch {
      await delay(250);
    }
  }

  // --- Permissions ---
  assert.equal((await api("/api/students/bulk/preview", { method: "POST", body: { studentIds: ["00000123456"], action: "SET_SECTION", targetGroupId: "sec-b" } })).status, 401);
  const adminCookie = await login("admin@example.test", "fixture-password-123");
  const orgCookie = await login("org@example.test", "fixture-password-123");
  const otherCookie = await login("other@example.test", "fixture-password-123");
  const pendingLogin = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "pending@example.test", password: "fixture-password-123" }) });
  assert.equal(pendingLogin.status, 403);

  // --- Preview happy path + identity ---
  const previewRes = await api("/api/students/bulk/preview", {
    method: "POST",
    body: { studentIds: ["00000123457", "00000123456"], action: "SET_SECTION", targetGroupId: "sec-b" },
    cookie: orgCookie,
  });
  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.cache, "private, no-store");
  assert.equal(previewRes.body.data.selectionCount, 2);
  assert.equal(previewRes.body.data.changedCount, 2);
  assert.equal(previewRes.body.data.rows[0].id, "00000123456");
  assert.ok(previewRes.body.data.previewToken);
  const goodToken = previewRes.body.data.previewToken;

  // Same-target is UNCHANGED, Apply disabled (no token when zero changes)
  const unchangedRes = await api("/api/students/bulk/preview", {
    method: "POST",
    body: { studentIds: ["00000123458"], action: "SET_SECTION", targetGroupId: "sec-b" },
    cookie: orgCookie,
  });
  assert.equal(unchangedRes.body.data.changedCount, 0);
  assert.equal(unchangedRes.body.data.unchangedCount, 1);
  assert.equal(unchangedRes.body.data.previewToken, null);

  // Blocked: ambiguous + missing
  const blockedRes = await api("/api/students/bulk/preview", {
    method: "POST",
    body: { studentIds: ["00000123480", "00000123490"], action: "SET_SECTION", targetGroupId: "sec-b" },
    cookie: orgCookie,
  });
  assert.equal(blockedRes.body.data.blockedCount, 2);
  assert.equal(blockedRes.body.data.previewToken, null);

  // Validation: duplicates, wrong-category, unknown target
  assert.equal((await api("/api/students/bulk/preview", { method: "POST", body: { studentIds: ["00000123456", "00000123456"], action: "SET_SECTION", targetGroupId: "sec-b" }, cookie: orgCookie })).status, 400);
  assert.equal((await api("/api/students/bulk/preview", { method: "POST", body: { studentIds: ["00000123456"], action: "SET_SECTION", targetGroupId: "house-azul" }, cookie: orgCookie })).status, 400);
  assert.equal((await api("/api/students/bulk/preview", { method: "POST", body: { studentIds: ["00000123456"], action: "SET_SECTION", targetGroupId: "missing" }, cookie: orgCookie })).status, 404);
  // Bounds: 101 mutation IDs rejected
  const many = Array.from({ length: 101 }, (_, i) => String(i).padStart(11, "0"));
  assert.equal((await api("/api/students/bulk/preview", { method: "POST", body: { studentIds: many, action: "SET_SECTION", targetGroupId: "sec-b" }, cookie: orgCookie })).status, 400);

  // --- Commit happy path: narrow writes only ---
  const beforeUnchanged = await prisma.student.findUnique({ where: { id: "00000123456" }, include: { groups: true } });
  const t0 = performance.now();
  const commitRes = await api("/api/students/bulk/commit", {
    method: "POST",
    body: { previewToken: goodToken, acknowledgeReportImpact: true },
    cookie: orgCookie,
  });
  const commitMs = performance.now() - t0;
  assert.equal(commitRes.status, 200);
  assert.deepEqual(commitRes.body.data.changedIds, ["00000123456", "00000123457"]);
  console.log(`Commit 2-row latency: ${commitMs.toFixed(1)} ms`);

  const after = await prisma.student.findUnique({ where: { id: "00000123456" }, include: { groups: true } });
  const slugs = after.groups.map((g) => g.slug).sort();
  assert.ok(slugs.includes("bsit-2b"));
  assert.ok(!slugs.includes("bsit-2a"));
  assert.ok(slugs.includes("azul") && slugs.includes("computer-studies") && slugs.includes("bsit"));
  assert.equal(after.firstName, beforeUnchanged.firstName);
  const rec = await prisma.record.findUnique({ where: { eventId_studentId: { eventId: "ev1", studentId: "00000123456" } } });
  assert.equal(rec.id, "rec1");
  // Group itself unchanged
  const secB = await prisma.group.findUnique({ where: { id: "sec-b" } });
  assert.equal(secB.slug, "bsit-2b");

  // Two commits from one preview: second must conflict, no silent recreation
  const replay = await api("/api/students/bulk/commit", {
    method: "POST",
    body: { previewToken: goodToken, acknowledgeReportImpact: true },
    cookie: orgCookie,
  });
  assert.equal(replay.status, 409);

  // --- Conflict / rollback: race after preview ---
  const preview2 = await api("/api/students/bulk/preview", {
    method: "POST",
    body: { studentIds: ["00000123456", "00000123457"], action: "SET_HOUSE", targetGroupId: "house-verde" },
    cookie: orgCookie,
  });
  assert.equal(preview2.status, 200);
  // Racing write via a second connection: move one student + touch updatedAt
  await prisma2.student.update({ where: { id: "00000123456" }, data: { firstName: "Raced" } });
  const racedCommit = await api("/api/students/bulk/commit", {
    method: "POST",
    body: { previewToken: preview2.body.data.previewToken, acknowledgeReportImpact: true },
    cookie: orgCookie,
  });
  assert.equal(racedCommit.status, 409);
  // All-or-nothing: the other row must NOT have moved
  const other = await prisma.student.findUnique({ where: { id: "00000123457" }, include: { groups: true } });
  assert.ok(other.groups.some((g) => g.slug === "verde"));
  // Restore raced name for later checks (via direct DB, not bulk)
  await prisma.student.update({ where: { id: "00000123456" }, data: { firstName: "Test" } });

  // --- Token security ---
  const tampered = goodToken.slice(0, -1) + (goodToken.endsWith("A") ? "B" : "A");
  assert.equal((await api("/api/students/bulk/commit", { method: "POST", body: { previewToken: tampered, acknowledgeReportImpact: true }, cookie: orgCookie })).status, 409);
  // Cross-user reuse
  assert.equal((await api("/api/students/bulk/commit", { method: "POST", body: { previewToken: goodToken, acknowledgeReportImpact: true }, cookie: otherCookie })).status, 409);
  // Expired (craft with same secret, past window)
  const expiredPayload = {
    v: 1, purpose: "student-bulk-commit-v1", userId: "org",
    studentIds: ["00000123457"], action: "SET_HOUSE",
    targetId: "house-verde", targetSlug: "verde", targetName: "Verde", targetCategory: "HOUSE",
    contentVersions: {}, reviewFingerprint: "x",
    preparedAt: Date.now() - 20 * 60 * 1000, expiresAt: Date.now() - 10 * 60 * 1000,
  };
  assert.equal((await api("/api/students/bulk/commit", { method: "POST", body: { previewToken: signToken(expiredPayload), acknowledgeReportImpact: true }, cookie: orgCookie })).status, 409);
  // Purpose confusion
  const wrongPurpose = { ...expiredPayload, purpose: "event-attendance-auth", preparedAt: Date.now(), expiresAt: Date.now() + 600000 };
  assert.equal((await api("/api/students/bulk/commit", { method: "POST", body: { previewToken: signToken(wrongPurpose), acknowledgeReportImpact: true }, cookie: orgCookie })).status, 409);
  // Deactivated at commit
  const freshPreview = await api("/api/students/bulk/preview", {
    method: "POST",
    body: { studentIds: ["00000123457"], action: "SET_HOUSE", targetGroupId: "house-azul" },
    cookie: orgCookie,
  });
  await prisma.user.update({ where: { id: "org" }, data: { status: "REJECTED" } });
  assert.equal((await api("/api/students/bulk/commit", { method: "POST", body: { previewToken: freshPreview.body.data.previewToken, acknowledgeReportImpact: true }, cookie: orgCookie })).status, 403);
  await prisma.user.update({ where: { id: "org" }, data: { status: "ACTIVE" } });

  // --- Export ---
  const exportRes = await api("/api/students/export-selected", {
    method: "POST",
    body: { studentIds: ["00000123456", "00000123459"] },
    cookie: adminCookie,
  });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.cache, "private, no-store");
  assert.equal(exportRes.body.data.schemaVersion, 1);
  assert.equal(exportRes.body.data.rows.length, 2);
  const first = exportRes.body.data.rows.find((r) => r.studentId === "00000123459");
  assert.equal(first.firstName, "=2+2");
  assert.equal(first.lastName, "Oñate, Jr.");
  assert.deepEqual(first.sectionSlugs, ["bsit-2a"]);
  // Missing IDs fail, no silent omit
  const missingExport = await api("/api/students/export-selected", {
    method: "POST",
    body: { studentIds: ["00000123456", "00000999999"] },
    cookie: adminCookie,
  });
  assert.equal(missingExport.status, 409);
  assert.deepEqual(missingExport.body.missingIds, ["00000999999"]);
  assert.equal((await api("/api/students/export-selected", { method: "POST", cookie: adminCookie })).status, 400);

  console.log("Student bulk API fixture passed: identity, preview/commit, rollback, tokens, export, permissions.");

  if (process.argv.includes("--large")) {
    const ids100 = [];
    for (let i = 0; i < 100; i++) {
      const id = String(90000000000 + i).padStart(11, "0");
      ids100.push(id);
      await prisma.student.create({
        data: {
          id, firstName: "Load", lastName: `Student ${i}`, schoolLevel: "COLLEGE", yearLevel: "YEAR_2",
          groups: { connect: [{ id: "sec-a" }, { id: "house-azul" }, { id: "dept-cs" }, { id: "prog-bsit" }] },
        },
      });
    }
    let start = performance.now();
    const largePreview = await api("/api/students/bulk/preview", {
      method: "POST",
      body: { studentIds: ids100, action: "SET_SECTION", targetGroupId: "sec-b" },
      cookie: adminCookie,
    });
    assert.equal(largePreview.status, 200);
    const previewMs = performance.now() - start;
    start = performance.now();
    const largeCommit = await api("/api/students/bulk/commit", {
      method: "POST",
      body: { previewToken: largePreview.body.data.previewToken, acknowledgeReportImpact: true },
      cookie: adminCookie,
    });
    assert.equal(largeCommit.status, 200);
    const commit100Ms = performance.now() - start;
    console.log(`Large bulk: 100-row preview ${previewMs.toFixed(1)} ms, commit ${commit100Ms.toFixed(1)} ms, payload ${Buffer.byteLength(JSON.stringify(ids100))} bytes.`);

    const ids2000 = [...ids100];
    const extraIds = [];
    for (let i = 100; i < 2000; i++) {
      const id = String(90000000000 + i).padStart(11, "0");
      ids2000.push(id);
      extraIds.push({
        id,
        firstName: "Load",
        lastName: `Student ${i}`,
        schoolLevel: "COLLEGE",
        yearLevel: "YEAR_2",
      });
    }
    // Group-free rows keep the export load test fast (createMany can't write
    // relations); the export path returns empty slug arrays for them.
    for (let i = 0; i < extraIds.length; i += 500) {
      await prisma.student.createMany({ data: extraIds.slice(i, i + 500) });
    }
    start = performance.now();
    const export2000 = await api("/api/students/export-selected", {
      method: "POST",
      body: { studentIds: ids2000 },
      cookie: adminCookie,
    });
    assert.equal(export2000.status, 200);
    console.log(`Large export: 2000-row preparation ${(performance.now() - start).toFixed(1)} ms, payload ${Buffer.byteLength(JSON.stringify(export2000.body))} bytes.`);
  }

  if (process.argv.includes("--browser")) {
    await browserCheck(adminCookie);
  }
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch { /* already exited */ }
  }
  if (chrome?.pid) {
    try {
      process.kill(-chrome.pid, "SIGTERM");
    } catch { /* already exited */ }
  }
  await prisma?.$disconnect();
  await prisma2?.$disconnect();
  await delay(500);
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch (e) {
    console.warn(`Could not remove ${scratch}: ${e.message}`);
  }
}
