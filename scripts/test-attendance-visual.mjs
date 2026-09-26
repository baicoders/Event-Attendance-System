import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";

const { Pool } = pg;
const temp = mkdtempSync(join(tmpdir(), "issue48-visual-"));
const secret = "issue48-visual-test-secret";
const port = await new Promise((resolve) => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    listener.close(() => resolve(address.port));
  });
});
let db;
let server;
let chrome;
let socket;
let pool;
let disposable;
try {
  disposable = await createDisposableDatabase("test_issue48_visual");
  pool = new Pool({ connectionString: disposable.url });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const owner = await db.user.create({ data: { name: "Owner", email: "owner@example.test", password: "test", status: "ACTIVE" } });
  const student = await db.student.create({ data: { id: "00000123456", firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const event = await db.event.create({ data: { title: "Foundation Day", category: "ALL", status: "APPROVED", createdById: owner.id,
    start: new Date(Date.now() - 3600000), end: new Date(Date.now() + 3600000) } });
  await db.record.create({ data: { eventId: event.id, studentId: student.id, method: "SCANNED", revision: 1,
    timein: new Date(Date.now() - 1800000), timeout: new Date(Date.now() - 900000), recordedById: owner.id } });
  const payload = Buffer.from(JSON.stringify({ session: { id: owner.id, name: owner.name, email: owner.email,
    role: owner.role, status: owner.status, rejectionReason: null, mustChangePassword: false,
    credentialVersion: owner.credentialVersion }, exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
  const cookie = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  server = spawn("pnpm", ["exec", "next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: disposable.url, AUTH_SECRET: secret, NODE_ENV: "production" }, stdio: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${base}/api/auth/session`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-allow-origins=*",
    "--remote-debugging-port=0", `--user-data-dir=${join(temp, "chrome")}`, "about:blank"], { stdio: "pipe" });
  const portFile = join(temp, "chrome", "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(existsSync(portFile), "Chrome debugger started");
  const debugPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const tab = tabs.find((item) => item.type === "page");
  assert.ok(tab, "Chrome page target exists");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Network.enable");
  await command("Network.setCookie", { name: "event-attendance-auth", value: cookie, url: base, httpOnly: true, sameSite: "Lax" });
  await command("Page.enable");
  for (const device of [{ name: "mobile", width: 375, height: 812, mobile: true }, { name: "desktop", width: 1440, height: 900, mobile: false }]) {
    await command("Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.mobile });
    await command("Page.navigate", { url: `${base}/attendance/corrections?eventId=${event.id}&studentId=${student.id}` });
    let body = "";
    for (let i = 0; i < 80; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = await command("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
      body = result.result.value ?? "";
      if (body.includes("Juan Cruz") && body.includes("Foundation Day")) break;
    }
    assert.match(body, /Juan Cruz/);
    assert.match(body, /Attendance review/);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`/tmp/issue48-${device.name}.png`, Buffer.from(screenshot.data, "base64"));
    console.log(`${device.name} review rendered at ${device.width}px`);
    if (device.mobile) {
      await command("Runtime.evaluate", { expression: "[...document.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Correct').at(-1)?.click()" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const editor = await command("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
      assert.match(editor.result.value, /Proposed/);
      const editorScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync("/tmp/issue48-mobile-editor.png", Buffer.from(editorScreenshot.data, "base64"));
    }
  }
} finally {
  socket?.close();
  const stop = async (child) => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  await stop(chrome);
  await stop(server);
  await db?.$disconnect();
  await pool?.end();
  await disposable?.cleanup();
  for (let attempt = 0; attempt < 5; attempt++) {
    try { rmSync(temp, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
