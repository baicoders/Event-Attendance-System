/** Disposable production API/browser fixture. Run after build. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const scratch = mkdtempSync(join(tmpdir(), "student-detail-"));
const dbUrl = `file:${join(scratch, "detail.db")}`;
const env = { ...process.env, DATABASE_URL: dbUrl, AUTH_SECRET: "student-detail-disposable-secret", NODE_ENV: "production" };
const port = await new Promise(resolve => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); }); });
const origin = `http://127.0.0.1:${port}`;
let server;
let chrome;
let db;
const form = { id: "00000123456", firstName: "Ana", lastName: "Lee", middleName: "",
  schoolLevel: "COLLEGE", yearLevel: "YEAR_2", section: "sec-a", house: "azul", department: "cs", program: "bsit", strand: "" };

async function request(path, cookie, options = {}) {
  const response = await fetch(`${origin}${path}`, { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
}

async function browserCheck(cookie) {
  const profile = join(scratch, "chrome");
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 80 && !existsSync(portFile); i++) await delay(100);
  assert.ok(existsSync(portFile), "Chrome DevTools port did not open");
  const chromePort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.text); return response.result.value; };
  const until = async expression => { for (let i = 0; i < 100; i++) { try { if (await evaluate(expression)) return; } catch { /* Navigation can replace the execution context. */ } await delay(100); } throw new Error(`Timed out: ${expression}; dialog=${await evaluate('document.querySelector("[role=dialog]")?.textContent?.slice(0,1000)')}`); };
  try {
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    const delimiter = cookie.indexOf("=");
    await command("Network.setCookie", { name: cookie.slice(0, delimiter), value: cookie.slice(delimiter + 1), url: origin });
    await command("Page.navigate", { url: `${origin}/students/00000123456` });
    await until('document.querySelector("h1")?.textContent?.includes("Anne Lee")');
    assert.ok(await evaluate('document.body.innerText.includes("Recent recorded events")'));
    assert.ok(await evaluate('document.body.innerText.includes("Section A")'));
    const qrMarkup = await evaluate('document.querySelector(".student-qr-code svg")?.outerHTML');
    assert.ok(qrMarkup?.includes("<svg"));
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent?.includes("View larger QR")).click()');
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("Student QR Code")');
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until('document.querySelector("[role=dialog]") === null');
    const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth');
    assert.equal(overflow, false, "student detail overflows 375px viewport");
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent?.includes("Edit student")).click()');
    await until('document.querySelector(\'[role=dialog] input[name="firstName"]\') !== null');
    await evaluate('(() => { const input = document.querySelector(\'[role=dialog] input[name="firstName"]\'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Annette"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await evaluate('[...document.querySelectorAll(\'[role=dialog] button\')].find(button => button.textContent?.includes("Cancel")).click()');
    await until('document.body.innerText.includes("Discard student changes?")');
    await evaluate('[...document.querySelectorAll(\'[role=dialog] button\')].find(button => button.textContent?.trim() === "Confirm").click()');
    await until('document.querySelector(\'[role=dialog] input[name="firstName"]\') === null');
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent?.includes("Edit student")).click()');
    await until('document.querySelector(\'[role=dialog] input[name="firstName"]\') !== null');
    await evaluate('(() => { const input = document.querySelector(\'[role=dialog] input[name="firstName"]\'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Anita"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await evaluate('[...document.querySelectorAll(\'[role=dialog] button\')].find(button => button.textContent?.trim() === "Next").click()');
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("Academic Standing")');
    await evaluate('[...document.querySelectorAll(\'[role=dialog] button\')].find(button => button.textContent?.trim() === "Next").click()');
    await until('document.querySelector("[role=dialog]")?.textContent?.includes("Group Assignments")');
    await evaluate('[...document.querySelectorAll(\'[role=dialog] button\')].find(button => button.textContent?.includes("Save Changes")).click()');
    await until('document.querySelector("h1")?.textContent?.includes("Anita Lee")');
    assert.equal(await evaluate('document.querySelector(".student-qr-code svg")?.outerHTML'), qrMarkup);
    await command("Page.navigate", { url: `${origin}/students/student-list?category=ALL` });
    await until('document.querySelector(\'a[href^="/students/00000123456"]\') !== null');
    const href = await evaluate('document.querySelector(\'a[href^="/students/00000123456"]\').getAttribute("href")');
    assert.ok(href.includes("returnTo="));
    await command("Page.navigate", { url: `${origin}/students/00000123456?tab=attendance` });
    await until('document.body.innerText.includes("Recorded participation")');
    await command("Page.navigate", { url: `${origin}/students/${encodeURIComponent("12345/67890")}` });
    await until('document.querySelector("h1")?.textContent?.includes("Slash Student")');
    await command("Page.navigate", { url: `${origin}/students/${encodeURIComponent("ab12%2F3456")}` });
    await until('document.querySelector("h1")?.textContent?.includes("Percent Student")');
    console.log("Browser fixture passed: direct mobile links including encoded separator, QR/modal stability after edit, dirty editor discard, saved edit, identity/groups, roster profile link, attendance tab, and 375px layout.");
  } finally { ws.close(); }
}

try {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });
  await db.user.create({ data: { id: "admin", name: "Admin", email: "admin@example.test", password: "fixture-password-123", role: "ADMIN", status: "ACTIVE" } });
  await db.user.create({ data: { id: "inactive", name: "Inactive", email: "inactive@example.test", password: "fixture-password-123", role: "ORGANIZER", status: "ACTIVE" } });
  for (const [id, name, slug, category] of [["sec", "Section A", "sec-a", "SECTION"], ["sec-b", "Section B", "sec-b", "SECTION"], ["house", "Azul", "azul", "HOUSE"], ["dept", "Computer Studies", "cs", "DEPARTMENT"], ["program", "BSIT", "bsit", "PROGRAM"]])
    await db.group.create({ data: { id, name, slug, category } });
  await db.student.create({ data: { id: form.id, firstName: form.firstName, lastName: form.lastName, schoolLevel: form.schoolLevel, yearLevel: form.yearLevel,
    groups: { connect: [{ id: "sec" }, { id: "house" }, { id: "dept" }, { id: "program" }] } } });
  server = spawn("pnpm", ["start", "-p", String(port)], { env, stdio: "pipe", detached: true });
  for (let i = 0; i < 80; i++) { if (server.exitCode !== null) throw new Error(`Server exited: ${server.exitCode}`); try { await fetch(`${origin}/api/auth/session`); break; } catch { await delay(250); } }
  const path = `/api/students/${form.id}`;
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, null, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: "fixture-password-123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const get = await request(path, cookie);
  assert.equal(get.status, 200);
  assert.equal(get.cache, "private, no-store");
  assert.equal(get.body.data.groups.length, 4);
  const version = get.body.data.editVersion;
  const patch = (expectedVersion, student, extra = {}) => request(path, cookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion, student, ...extra }) });
  assert.equal((await patch(version, { ...form, id: "00000999999" })).body.code, "STUDENT_ID_MISMATCH");
  assert.equal((await patch(version, { ...form, role: "ADMIN" })).status, 400);
  assert.equal((await patch(version, form, { records: [] })).status, 400);
  const noop = await patch(version, form);
  assert.equal(noop.status, 200);
  assert.equal(noop.body.data.changed, false);
  const changed = await patch(version, { ...form, firstName: "Anne" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.firstName, "Anne");
  assert.equal((await patch(version, form)).body.code, "STUDENT_EDIT_CONFLICT");
  const newVersion = changed.body.data.editVersion;
  assert.equal((await patch(newVersion, { ...form, section: "missing" })).body.code, "INVALID_GROUPS");
  await db.group.update({ where: { id: "sec-b" }, data: { students: { connect: { id: form.id } } } });
  const ambiguous = await request(path, cookie);
  assert.notEqual(ambiguous.body.data.editVersion, newVersion);
  assert.equal((await patch(ambiguous.body.data.editVersion, form)).body.code, "STUDENT_GROUP_REVIEW_REQUIRED");
  await db.group.update({ where: { id: "sec-b" }, data: { students: { disconnect: { id: form.id } } } });
  const inactiveLogin = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "inactive@example.test", password: "fixture-password-123" }) });
  const inactiveCookie = inactiveLogin.headers.get("set-cookie")?.split(";")[0];
  await db.user.update({ where: { id: "inactive" }, data: { status: "PENDING" } });
  assert.equal((await request(path, inactiveCookie)).status, 403);
  const specialId = "12345/67890";
  await db.student.create({ data: { id: specialId, firstName: "Slash", lastName: "Student", schoolLevel: "SHS", yearLevel: "GRADE_11" } });
  await db.student.create({ data: { id: "ab12%2F3456", firstName: "Percent", lastName: "Student", schoolLevel: "SHS", yearLevel: "GRADE_11" } });
  const special = await request(`/api/students/${encodeURIComponent(specialId)}`, cookie);
  assert.equal(special.status, 200);
  assert.equal(special.body.data.id, specialId);
  assert.equal((await request(`/api/students/${encodeURIComponent("ab12%2F3456")}`, cookie)).body.data.id, "ab12%2F3456");
  if (process.argv.includes("--browser")) await browserCheck(cookie);
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: form.id } })).yearLevel, "YEAR_2");
  const beforeLegacy = await request(path, cookie);
  const legacy = await request("/api/students", cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, firstName: "Annie" }) });
  assert.equal(legacy.status, 200);
  assert.equal((await patch(beforeLegacy.body.data.editVersion, { ...form, firstName: "Stale" })).body.code, "STUDENT_EDIT_CONFLICT");
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: form.id } })).firstName, "Annie");
  await db.student.delete({ where: { id: form.id } });
  assert.equal((await patch(newVersion, form)).status, 404);
  assert.equal(await db.student.count(), 2);
  console.log("Student detail API fixture passed: auth, ID and field validation, no-op, edit-only save, legacy-write conflict, group review, encoded ID, and deletion.");
} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  if (chrome?.pid) { try { process.kill(-chrome.pid, "SIGTERM"); } catch {} }
  await db?.$disconnect();
  await delay(500);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
