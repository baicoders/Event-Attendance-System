import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClassroomTestApp } from './classroom-test-app.mjs';
function routes(dir = 'app/api') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routes(join(dir, entry.name)) : entry.name === 'route.ts' ? [join(dir, entry.name)] : []);
}
await withClassroomTestApp(async ({ db, request }) => {
  const teacher = await db.user.create({ data: { name: 'Teacher', email: 'boundaries-teacher@example.test', password: 'test-password', role: 'MEMBER', status: 'ACTIVE' } });
  await db.classroomMembership.create({ data: { userId: teacher.id, status: 'APPROVED', departmentOrDesignation: 'Teacher' } });
  const login = await request('/api/auth/login', { method: 'POST', body: { email: teacher.email, password: 'test-password', workspace: 'CLASS' } });
  assert.equal(login.response.status, 200, login.text);
  let checked = 0;
  for (const file of routes().filter(v => !v.includes('/classroom/') && !v.includes('/auth/'))) {
    const path = file.replace(/^app/, '').replace(/\/route.ts$/, '').replace(/\[[^\]]+\]/g, 'missing');
    for (const [, method] of readFileSync(file, 'utf8').matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)) {
      const result = await request(path, { method, cookie: login.cookie, ...(['GET', 'HEAD'].includes(method) ? {} : { body: {} }) });
      assert.equal(result.response.status, 403, `${method} ${path}: ${result.response.status} ${result.text.slice(0, 300)}`);
      assert.match(result.response.headers.get('cache-control') ?? '', /private/);
      const visitor = await request(path, { method, ...(['GET', 'HEAD'].includes(method) ? {} : { body: {} }) });
      assert.equal(visitor.response.status, 401, `visitor ${method} ${path}: ${visitor.text.slice(0, 200)}`);
      checked++;
    }
  }
  for (const status of ['PENDING', 'REJECTED', 'SUSPENDED', 'REVOKED']) {
    await db.classroomMembership.update({ where: { userId: teacher.id }, data: { status } });
    assert.equal((await request('/api/students', { cookie: login.cookie })).response.status, 403);
  }
  await db.classroomMembership.update({ where: { userId: teacher.id }, data: { status: 'APPROVED' } });
  const organizer = await db.user.create({ data: { name: 'Organizer', email: 'boundaries-organizer@example.test', password: 'test-password', role: 'ORGANIZER', status: 'ACTIVE' } });
  const organizerLogin = await request('/api/auth/login', { method: 'POST', body: { email: organizer.email, password: 'test-password' } });
  assert.equal(organizerLogin.response.status, 200);
  for (const [method, path] of [['POST', '/api/students/bulk/preview'], ['POST', '/api/students/bulk/commit'], ['DELETE', '/api/students/missing']]) {
    const result = await request(path, { method, cookie: organizerLogin.cookie, body: {} });
    assert.equal(result.response.status, 403, `organizer ${method} ${path}: ${result.text}`);
  }
  const untrustedPolicy = await request('/api/classroom/application', { method: 'PUT', cookie: organizerLogin.cookie, body: { commandId: crypto.randomUUID(), action: 'SUBMIT', departmentOrDesignation: 'Teacher', policy: 'ADMIN' } });
  assert.equal(untrustedPolicy.response.status, 400);
  const crossSite = await request('/api/classroom/application', { method: 'PUT', cookie: login.cookie, body: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(crossSite.response.status, 403);
  assert.equal(crossSite.json.code, 'CROSS_SITE_REQUEST');
  const print = await request('/reports/events/missing/print', { cookie: login.cookie });
  assert.ok([200, 307, 308].includes(print.response.status));
  if (print.response.status === 200) assert.match(print.text, /do not have access|not have permission/i);
  console.log(`PASS ${checked} legacy method/path teacher denials, organizer destructive/bulk denials, cross-origin denial and direct print guard.`);
});
