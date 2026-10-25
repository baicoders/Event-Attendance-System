/** API and real-browser regression. Requires a production build and TEST_DATABASE_URL.
 * All mutations use a migrated disposable database; never DATABASE_URL from .env.
 * Run: node scripts/test-custom-groups.mjs
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDatabase } from './pg-test-db.mjs';

assert.ok(existsSync('.next/BUILD_ID'), 'Run the production build first');
const fixture = await createDisposableDatabase('test_custom_groups');
const pool = new Pool({ connectionString: fixture.url });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const scratch = mkdtempSync(join(tmpdir(), 'custom-groups-smoke-'));
const secret = 'custom-groups-disposable-fixture-secret';
const port = await new Promise(resolve => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1', () => {
    const assigned = listener.address().port;
    listener.close(() => resolve(assigned));
  });
});
const origin = `http://127.0.0.1:${port}`;
let server, chrome, ws, adminCookie;
let serverLog = '';

function cookieFor(user) {
  const session = { id: user.id, name: user.name, email: user.email, role: user.role,
    status: user.status, credentialVersion: user.credentialVersion, mustChangePassword: false };
  const encoded = Buffer.from(JSON.stringify({ session, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `event-attendance-auth=${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

async function api(path, { method = 'GET', body, cookie = adminCookie, status } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
  else assert.ok(response.ok && json.success, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function openBrowser() {
  const profile = join(scratch, 'chrome');
  chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', detached: true });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
  assert.ok(existsSync(portFile), 'Chrome started');
  const chromePort = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let nextId = 0;
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Browser timeout: ${expression}; body=${await evaluate('document.body.innerText.slice(0,1800)')}`);
  };
  const click = async label => {
    const expression = `[...(document.querySelector('[role="dialog"]')||document).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`Boolean(${expression})`);
    await evaluate(`${expression}.click()`);
  };
  const fill = async (selector, value) => {
    await until(`Boolean(${selector})`);
    await evaluate(`(()=>{const el=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const split = adminCookie.indexOf('=');
  await command('Network.setCookie', { name: adminCookie.slice(0, split), value: adminCookie.slice(split + 1), url: origin });
  return { command, evaluate, until, click, fill };
}

try {
  const admin = await db.user.create({ data: { name: 'Synthetic Admin', email: 'custom-admin@example.test', password: 'fixture', role: 'ADMIN', status: 'ACTIVE' } });
  const organizer = await db.user.create({ data: { name: 'Synthetic Organizer', email: 'custom-org@example.test', password: 'fixture', role: 'ORGANIZER', status: 'ACTIVE' } });
  adminCookie = cookieFor(admin);
  const students = await Promise.all(['Alpha', 'Beta', 'Outsider'].map((lastName, i) => db.student.create({ data: {
    firstName: 'Synthetic', lastName, usn: `0000012345${i}`, lrn: `00000012345${i}`, schoolLevel: 'COLLEGE', yearLevel: 'YEAR_2',
  } })));
  const academic = await db.group.create({ data: { name: 'Academic Section', slug: 'academic-section', category: 'SECTION' } });
  await db.student.update({ where: { id: students[0].id }, data: { groups: { connect: { id: academic.id } } } });
  server = spawn('pnpm', ['start', '-p', String(port)], {
    env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, AUTH_SECRET: secret, NODE_ENV: 'production' },
    stdio: 'pipe', detached: true,
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog = (serverLog + chunk).slice(-20000); });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${serverLog}`);
    try { if ((await fetch(`${origin}/api/auth/session`)).status < 500) { ready = true; break; } } catch { /* starting */ }
    await delay(250);
  }
  assert.ok(ready, 'Disposable production server ready');
  await api('/api/custom-groups', { cookie: null, status: 401 });
  await api('/api/custom-groups', { method: 'POST', cookie: cookieFor(organizer), body: { name: 'Forbidden' }, status: 403 });
  await api('/api/custom-groups', { cookie: cookieFor(organizer) });

  const browser = await openBrowser();
  const { command, evaluate, until, click, fill } = browser;
  await command('Page.navigate', { url: `${origin}/custom-groups` });
  await click('Create group');
  await fill('document.querySelector(\'[role="dialog"] input[name="name"]\')', 'Synthetic Club');
  await click('Create group');
  await until('location.pathname.startsWith("/custom-groups/") && document.querySelector("h1")?.textContent==="Synthetic Club"');
  const groupId = await evaluate('location.pathname.split("/").pop()');
  await click('Rename group');
  await fill('document.querySelector(\'[role="dialog"] input[name="name"]\')', 'Synthetic USWAG');
  await click('Save name');
  await until('document.querySelector("h1")?.textContent==="Synthetic USWAG" && !document.querySelector("[role=dialog]")');
  await fill('document.querySelector(\'input[type="search"]\')', students[0].usn);
  await until('Boolean(document.querySelector("input[type=radio]"))');
  await evaluate('document.querySelector("input[type=radio]").click()');
  await fill('[...document.querySelectorAll("label")].find(l=>l.textContent.trim()==="Position (optional)") && document.getElementById([...document.querySelectorAll("label")].find(l=>l.textContent.trim()==="Position (optional)").htmlFor)', 'President');
  await click('Add member');
  await until('Boolean(document.querySelector(\'input[aria-label^="Position for"]\'))');
  await fill('document.querySelector(\'input[aria-label^="Position for"]\')', 'Chair');
  await evaluate('document.querySelector(\'button[aria-label^="Save position for"]\').click()');
  await until('document.querySelector(\'button[aria-label^="Save position for"]\')?.disabled');
  // Wait for the persisted response, not just the mutation's pending state.
  for (let i = 0; i < 100; i++) {
    if ((await api(`/api/custom-groups/${groupId}`)).members[0]?.position === 'Chair') break;
    await delay(100);
  }
  await command('Page.reload');
  await until('document.querySelector("h1")?.textContent==="Synthetic USWAG" && document.querySelector(\'input[aria-label^="Position for"]\')?.value==="Chair"');
  const detail = await api(`/api/custom-groups/${groupId}`);
  assert.equal(detail.memberCount, 1);
  assert.equal(detail.members[0].position, 'Chair');
  writeFileSync('/tmp/custom-groups-smoke.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('Browser passed: create, rename, search/select/add, position save and reload persistence.');

  const groupB = await api('/api/custom-groups', { method: 'POST', body: { name: 'Synthetic Team' } });
  await api(`/api/custom-groups/${groupB.id}/members`, { method: 'POST', body: { studentId: students[1].id } });
  await api(`/api/custom-groups/${groupB.id}/members`, { method: 'POST', body: { studentId: students[0].id }, status: 409 });

  // QR group rosters must use custom memberships, never the academic join table.
  await api(`/api/students?customGroupId=${groupId}`, { cookie: null, status: 401 });
  assert.deepEqual((await api(`/api/students?category=ALL&customGroupId=${groupId}`)).map(s => s.id), [students[0].id]);
  assert.deepEqual((await api(`/api/students?customGroupId=${groupB.id}`, { cookie: cookieFor(organizer) })).map(s => s.id), [students[1].id]);
  for (const id of [academic.id, 'nonexistent-custom-group']) assert.deepEqual(await api(`/api/students?customGroupId=${id}`), []);
  assert.deepEqual(await api(`/api/students?category=SHS&customGroupId=${groupId}`), []);
  await api('/api/students?customGroupId=', { status: 400 });
  const emptyGroup = await api('/api/custom-groups', { method: 'POST', body: { name: 'Synthetic Empty Group' } });
  const extraMembers = await Promise.all(Array.from({ length: 51 }, (_, index) => db.student.create({ data: {
    firstName: 'Synthetic', lastName: `Team Member ${String(index).padStart(2, '0')}`,
    customMemberships: { create: { groupId: groupB.id } },
  } })));
  await command('Page.navigate', { url: `${origin}/custom-groups/${groupId}` });
  await until('Boolean(document.querySelector(\'a[href*="/students/qr-codes"]\'))');
  await evaluate('document.querySelector(\'a[href*="/students/qr-codes"]\').click()');
  const printedCards = 'document.querySelectorAll(".student-qr-print-area .student-qr-card")';
  const previewCards = 'document.querySelectorAll(".no-print .student-qr-card")';
  await until(`document.querySelector('#qr-custom-group')?.value === ${JSON.stringify(groupId)} && ${printedCards}.length === 1`);
  await until('Object.keys(document.querySelector("#qr-custom-group")).some(key=>key.startsWith("__reactProps"))');
  const choose = async (selector, value) => evaluate(`(()=>{const el=${selector};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate(`${printedCards}[0].querySelector('svg title').textContent`), `USN QR: ${students[0].usn}`);
  await choose('[...document.querySelectorAll("label")].find(label=>label.textContent.includes("Preferred QR identifier")).querySelector("select")', 'LRN');
  await until(`${printedCards}[0]?.querySelector('svg title').textContent === ${JSON.stringify(`LRN QR: ${students[0].lrn}`)}`);
  await evaluate('document.querySelector(".no-print .relative input[type=checkbox]").click()');
  await until('document.querySelector("input[name=qr-scope]").checked');
  await fill('document.querySelector(\'input[type="search"]\')', 'no student matches this');
  await until(`${previewCards}.length === 0`);
  await choose('document.querySelector("#qr-custom-group")', groupB.id);
  await until(`new URL(location.href).searchParams.get('customGroupId') === ${JSON.stringify(groupB.id)} && ${printedCards}.length === 52 && ${previewCards}.length === 48`);
  await until(`[...${printedCards}].every(card=>card.querySelector('.student-qr-group-name')?.textContent===${JSON.stringify(groupB.name)})`);
  assert.equal(await evaluate(`[...${previewCards}].every(card=>card.querySelector('.student-qr-group-name')?.textContent===${JSON.stringify(groupB.name)})`), true);
  assert.equal(await evaluate('document.querySelector(\'input[type="search"]\').value'), '');
  assert.equal(await evaluate('document.querySelectorAll("input[name=qr-scope]")[1].checked'), true);
  assert.equal(await evaluate('document.querySelector(".no-print").textContent.includes("Selected students (0)")'), true);
  assert.equal(await evaluate(`document.querySelector('.student-qr-print-area').textContent.includes(${JSON.stringify(students[0].lrn)})`), false);
  assert.equal(await evaluate(`Boolean([...${printedCards}].find(card=>card.querySelector('svg title').textContent===${JSON.stringify(`LRN QR: ${students[1].lrn}`)}))`), true);
  writeFileSync('/tmp/custom-group-qr-manager.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const qrPdf = Buffer.from((await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  assert.equal(qrPdf.subarray(0, 4).toString(), '%PDF');
  writeFileSync('/tmp/custom-group-qr-print.pdf', qrPdf);
  for (const [size, perPage] of [['standard', 12], ['large', 6]]) {
    await evaluate(`document.querySelectorAll('input[name="qr-size"]')[${size === 'large' ? 1 : 0}].click()`);
    await until(`document.querySelector('.student-qr-print-area').classList.contains('student-qr-print-${size}')`);
    await command('Emulation.setEmulatedMedia', { media: 'print' });
    const layout = await evaluate(`(() => {
      const cards = [...${printedCards}];
      cards[0].querySelector('.student-qr-group-name').textContent = 'W'.repeat(80);
      const dimensions = cards.map(card => {
        const box = card.getBoundingClientRect();
        const children = [...card.children].map(child => child.getBoundingClientRect());
        const svg = card.querySelector('svg').getBoundingClientRect();
        return { width: box.width, height: box.height,
          fits: children.every(child => child.top >= box.top && child.bottom <= box.bottom + 1 && child.left >= box.left && child.right <= box.right + 1),
          square: Math.abs(svg.width - svg.height) < 1 };
      });
      return { dimensions, sheetCounts: [...document.querySelectorAll('.student-qr-print-sheet')].map(sheet => sheet.children.length) };
    })()`);
    assert.ok(layout.dimensions.every(card => card.fits && card.square), `${size} group headers and square QR codes fit inside their cards: ${JSON.stringify(layout.dimensions[0])}`);
    assert.deepEqual(layout.sheetCounts, [...Array(Math.floor(52 / perPage)).fill(perPage), ...(52 % perPage ? [52 % perPage] : [])]);
    await evaluate(`${printedCards}[0].querySelector('.student-qr-group-name').textContent=${JSON.stringify(groupB.name)}`);
    writeFileSync(`/tmp/custom-group-qr-${size}.pdf`, Buffer.from((await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: 'screen' });
  }
  await fill('document.querySelector(\'input[type="search"]\')', 'Beta');
  await until(`${printedCards}.length === 1`);
  await evaluate('document.querySelectorAll("input[name=qr-scope]")[2].click()');
  await until(`${printedCards}.length === 52`);
  await choose('document.querySelector("#qr-custom-group")', emptyGroup.id);
  await until(`new URL(location.href).searchParams.get('customGroupId') === ${JSON.stringify(emptyGroup.id)} && ${printedCards}.length === 0`);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Print QR Codes")).disabled'), true);
  await choose('document.querySelector("#qr-custom-group")', '');
  await until(`${printedCards}.length === 54 && !new URL(location.href).searchParams.has('customGroupId')`);
  assert.equal(await evaluate('document.querySelectorAll(".student-qr-print-area .student-qr-group-name").length'), 0);
  await choose('document.querySelector("#qr-custom-group")', groupId);
  await until(`${printedCards}.length === 1`);
  await command('Page.reload');
  await until(`document.querySelector('#qr-custom-group')?.value === ${JSON.stringify(groupId)} && ${printedCards}.length === 1`);
  await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  writeFileSync('/tmp/custom-group-qr-mobile.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await db.student.deleteMany({ where: { id: { in: extraMembers.map(student => student.id) } } });
  console.log('QR groups passed: scoped API/auth, detail link, switching clears selection/search, all 52 members print across preview pages, USN/LRN, empty groups, reload, mobile, and PDF.');

  const groupIds = [groupId, groupB.id];
  const audience = () => api('/api/events/audience-preview', { method: 'POST', body: { category: 'CUSTOM', includedGroups: groupIds, includeRoster: true } });
  assert.deepEqual((await audience()).students.map(s => s.id).sort(), students.slice(0, 2).map(s => s.id).sort());
  const eventInput = { title: 'Synthetic USWAG Event', location: null, description: null, category: 'CUSTOM',
    includedGroups: [academic.id], start: new Date(Date.now() - 20 * 60000).toISOString(), end: new Date(Date.now() + 3600000).toISOString(), allDay: false };
  await api('/api/events', { method: 'POST', body: eventInput, status: 400 });
  await api('/api/events', { method: 'POST', body: { ...eventInput, category: 'SECTION', includedGroups: [groupId] }, status: 400 });
  const event = await db.event.create({ data: { title: eventInput.title, category: 'CUSTOM', status: 'APPROVED', createdById: admin.id,
    start: new Date(eventInput.start), end: new Date(eventInput.end), includedGroups: { connect: groupIds.map(id => ({ id })) } } });
  await api('/api/events', { method: 'POST', body: { ...eventInput, id: event.id, includedGroups: groupIds, title: 'Edited Synthetic USWAG Event' } });
  await api(`/api/events/${event.id}`, { method: 'PATCH', body: { ...eventInput, includedGroups: groupIds, title: 'Edited Synthetic USWAG Event' } });
  for (const [i, method] of ['SCANNED', 'MANUAL'].entries()) {
    await api('/api/records', { method: 'POST', body: { eventId: event.id, studentId: students[i].usn, method, expectedMode: 'TIME_IN' } });
    await api('/api/records', { method: 'POST', body: { eventId: event.id, studentId: students[2].usn, method, expectedMode: 'TIME_IN' }, status: 404 });
  }
  assert.equal(await db.record.count(), 2);
  assert.equal(await db.record.count({ where: { studentId: students[2].id } }), 0);

  await command('Page.navigate', { url: `${origin}/reports/events/${event.id}/print?grouped=0&columns=name,identifier,group,position,status,timein` });
  await until('document.querySelector(".print-table th") && [...document.querySelectorAll(".print-table th")].some(el=>el.textContent==="Position")');
  const schedule=await evaluate('document.querySelector("dl").innerText');
  assert.match(schedule,/Philippine time \(UTC\+08:00\)/);
  assert.match(schedule,/\d{1,2}:\d{2} [AP]M/);
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(schedule),false);
  const toggleIdentifier = '[...document.querySelectorAll("label")].find(l=>l.textContent.trim()==="USN/LRN").querySelector("input")';
  await until(`Boolean(${toggleIdentifier})`);
  // Print markup is server-rendered; wait for hydration before dispatching a
  // click, otherwise the native checkbox changes without a router transition.
  await until(`Object.keys(${toggleIdentifier}).some(key=>key.startsWith('__reactProps'))`);
  await evaluate(`${toggleIdentifier}.click()`);
  await until('![...document.querySelectorAll(".print-table th")].some(el=>el.textContent==="USN/LRN")');
  await until(`!${toggleIdentifier}.closest('fieldset').disabled`);
  await evaluate(`${toggleIdentifier}.click()`);
  await until('[...document.querySelectorAll(".print-table th")].some(el=>el.textContent==="USN/LRN")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".print-table thead tr:first-child th")].map(el=>el.textContent)'),
    ['No.', 'Name', 'USN/LRN', 'Group', 'Position', 'Attendance Status', 'Check-in Time']);
  assert.equal(await evaluate('[...document.querySelectorAll(".print-table tbody tr")].every(tr=>tr.cells.length===7)'), true);
  await until('document.querySelector(".print-table").innerText.includes("Chair")');
  await evaluate(`document.querySelector('[aria-label="Group attendance by"]').focus()`);
  for (const key of ['ArrowDown', 'End', 'Enter']) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key });
    await delay(150);
  }
  await until('new URL(location.href).searchParams.get("sheetGroupBy") === "CUSTOM" && document.querySelectorAll(".print-table").length === 2');
  assert.equal(await evaluate('document.body.innerText.includes("Synthetic Team subtotal: 1 of 1 attended")'), true);
  assert.equal(await evaluate('document.body.innerText.includes("Synthetic USWAG subtotal: 1 of 1 attended")'), true);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".print-table tbody tr")].map(tr=>tr.cells[0].textContent)'), ['1', '2']);
  await fill('document.querySelector("#print-noted-by")', '  Dean of Students  ');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Print").disabled'), true);
  await click('Apply');
  await until('new URL(location.href).searchParams.get("notedBy") === "Dean of Students" && [...document.querySelectorAll("section p")].some(p=>p.textContent==="Dean of Students")');
  await until('![...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Print").disabled');
  assert.equal(await evaluate('document.querySelector("header").innerText.trim()'), 'EVENT ATTENDANCE SHEET');
  assert.equal(await evaluate('Boolean(document.querySelector("header img"))'), false);
  assert.equal(await evaluate('document.body.innerText.includes("Reflects the student roster")'), false);
  assert.equal(await evaluate('[...document.querySelectorAll("h3")].every(h=>getComputedStyle(h).borderBottomWidth==="0px")'), true);
  await command('Page.reload');
  await until('document.querySelector("#print-noted-by")?.value === "Dean of Students" && document.querySelectorAll(".print-table").length === 2');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("header")).borderBottomWidth'), '2px');
  assert.equal(await evaluate('document.querySelector("footer").innerText.includes("Made by Programmers Guild")'), true);
  await until('Object.keys(document.querySelector("#print-late")).some(key=>key.startsWith("__reactProps"))');
  assert.equal(await evaluate('[...document.querySelectorAll("strong")].find(el=>el.textContent==="Present:").parentElement.textContent.trim()'), 'Present: 0');
  assert.equal(await evaluate('[...document.querySelectorAll("strong")].find(el=>el.textContent==="Late:").parentElement.textContent.trim()'), 'Late: 2');
  await evaluate('document.querySelector("#print-late").click()');
  await until('new URL(location.href).searchParams.get("late") === "0" && ![...document.querySelectorAll("strong")].some(el=>el.textContent==="Late:")');
  assert.equal(await evaluate('[...document.querySelectorAll("strong")].some(el=>el.textContent==="Eligible:")'), true);
  assert.equal(await evaluate('[...document.querySelectorAll("strong")].find(el=>el.textContent==="Present:").parentElement.textContent.trim()'), 'Present: 2');
  assert.equal(await evaluate('[...document.querySelectorAll(".print-table tbody tr")].every(row=>row.textContent.includes("Late"))'), true);
  await evaluate('document.fonts.ready.then(()=>true)');
  const pdf = Buffer.from((await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
  writeFileSync('/tmp/uswag-print-smoke.pdf', pdf);
  writeFileSync('/tmp/uswag-print-smoke.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('Print passed: checkbox updates headings and cells; PDF /tmp/uswag-print-smoke.pdf and screenshot /tmp/uswag-print-smoke.png.');

  const recorded = await db.record.findUniqueOrThrow({ where: { eventId_studentId: { eventId: event.id, studentId: students[0].id } } });
  const historyCount = await db.attendanceChange.count({ where: { recordId: recorded.id } });
  await api(`/api/custom-groups/${groupId}/members/${students[0].id}`, { method: 'DELETE' });
  assert.deepEqual((await audience()).students.map(s => s.id), [students[1].id]);
  assert.equal((await api(`/api/custom-groups/${groupId}`)).memberCount, 0);
  assert.equal((await db.record.findUniqueOrThrow({ where: { id: recorded.id } })).timein.toISOString(), recorded.timein.toISOString());
  assert.equal(await db.attendanceChange.count({ where: { recordId: recorded.id } }), historyCount);
  assert.ok(historyCount > 0);
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: students[0].id }, include: { groups: true } })).groups[0].id, academic.id);
  console.log('API passed: permissions, membership conflict, category mismatch, roster union, scanned/manual eligibility, live removal and preserved attendance/audit/academic membership.');
} catch (error) {
  writeFileSync('/tmp/custom-groups-server.log', serverLog);
  throw error;
} finally {
  ws?.close();
  for (const child of [chrome, server]) {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
  await db.$disconnect();
  await pool.end();
  await fixture.cleanup();
  await delay(300);
  rmSync(scratch, { recursive: true, force: true });
}
