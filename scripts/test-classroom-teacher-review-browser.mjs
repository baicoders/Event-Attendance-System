import './test-browser-origin.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { withClassroomTestApp } from './classroom-test-app.mjs';

const resultPath = '/tmp/classroom-overhaul-teacher-review-browser.json';
await withClassroomTestApp(async ({ db, base, request }) => {
  const password = 'disposable-teacher-review-password';
  const admin = await db.user.create({ data: { name: 'Review Administrator', email: 'review-admin@example.test', password, role: 'ADMIN', status: 'ACTIVE' } });
  const login = async (user) => {
    const value = await request('/api/auth/login', { method: 'POST', body: { email: user.email, password, workspace: 'CLASS' } });
    assert.equal(value.response.status, 200, 'Fixture login failed');
    assert.ok(value.cookie);
    return value.cookie;
  };
  const fixtures = { admin: { id: admin.id, cookie: await login(admin) } };
  const definitions = [
    ['first', null], ['pending', 'PENDING'], ['approved', 'APPROVED'], ['rejected', 'REJECTED'], ['suspended', 'SUSPENDED'], ['revoked', 'REVOKED'],
    ['reject', 'PENDING'], ['stale', 'PENDING'], ['uncertain', 'PENDING'],
  ];
  for (const [key, status] of definitions) {
    const user = await db.user.create({ data: { name: `Review ${key}`, email: `review-${key}@example.test`, password, role: 'MEMBER', status: 'PENDING' } });
    if (status) await db.classroomMembership.create({ data: { userId: user.id, status, departmentOrDesignation: `Faculty ${key}`, staffReference: `STAFF-${key}`, applicationText: `Application details for ${key}`, ...(status !== 'PENDING' ? { decisionReason: `Fixture reason for ${key}`, reviewedAt: new Date(), reviewerId: admin.id, reviewerName: admin.name } : {}) } });
    fixtures[key] = { id: user.id, name: user.name, status, cookie: await login(user) };
  }
  console.log('Disposable production app ready; fixture users and membership states created.');
  const run = spawnSync('python3', ['scripts/test-classroom-teacher-review-browser.py'], {
    env: { ...process.env, CLASSROOM_TEST_BASE: base, CLASSROOM_TEACHER_REVIEW_FIXTURES: JSON.stringify(fixtures), CLASSROOM_TEACHER_REVIEW_RESULT: resultPath },
    encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024,
  });
  console.log(run.stdout);
  if (run.stderr) console.error(run.stderr);
  const checks = [];
  const check = async (label, callback) => { try { await callback(); checks.push({ label, passed: true }); } catch (error) { checks.push({ label, passed: false, error: error.message }); } };
  await check('first application commits exactly once after uncertain acknowledgement', async () => {
    const member = await db.classroomMembership.findUniqueOrThrow({ where: { userId: fixtures.first.id } });
    assert.equal(member.status, 'PENDING'); assert.equal(member.revision, 0);
    assert.equal(await db.classroomAudit.count({ where: { entityId: fixtures.first.id, action: 'TEACHER_APPLICATION_SUBMITTED' } }), 1);
  });
  await check('approve suspend restore revoke restore leaves expected state and complete audit history', async () => {
    const member = await db.classroomMembership.findUniqueOrThrow({ where: { userId: fixtures.pending.id } });
    assert.equal(member.status, 'APPROVED'); assert.equal(member.revision, 5);
    const rows = await db.classroomAudit.findMany({ where: { entityId: fixtures.pending.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(rows.map(row => row.action), ['TEACHER_APPROVE', 'TEACHER_SUSPEND', 'TEACHER_RESTORE', 'TEACHER_REVOKE', 'TEACHER_RESTORE']);
    assert.ok(rows.slice(1).every(row => row.reason));
  });
  await check('rejected applicant can resubmit', async () => {
    const member = await db.classroomMembership.findUniqueOrThrow({ where: { userId: fixtures.reject.id } });
    assert.equal(member.status, 'PENDING'); assert.equal(member.revision, 2);
  });
  await check('stale review preserves newer rejection and writes no second decision', async () => {
    const member = await db.classroomMembership.findUniqueOrThrow({ where: { userId: fixtures.stale.id } });
    assert.equal(member.status, 'REJECTED'); assert.equal(member.revision, 1);
    assert.equal(await db.classroomAudit.count({ where: { entityId: fixtures.stale.id } }), 1);
  });
  await check('uncertain decision retry commits one review and one command receipt', async () => {
    const member = await db.classroomMembership.findUniqueOrThrow({ where: { userId: fixtures.uncertain.id } });
    assert.equal(member.status, 'APPROVED'); assert.equal(member.revision, 1);
    assert.equal(await db.classroomAudit.count({ where: { entityId: fixtures.uncertain.id } }), 1);
    assert.equal(await db.classroomCommandReceipt.count({ where: { resourceId: fixtures.uncertain.id, operation: 'TEACHER_REVIEW' } }), 1);
  });
  console.log(JSON.stringify({ databaseChecks: checks }, null, 2));
  writeFileSync('/tmp/classroom-overhaul-teacher-review-db.json', JSON.stringify(checks, null, 2));
  assert.equal(run.status, 0, 'Teacher review browser checks failed; inspect /tmp/classroom-overhaul-teacher-review.log and browser report.');
  assert.ok(checks.every(check => check.passed), 'Teacher review database assertions failed.');
  console.log('PASS production-backed teacher review browser and disposable database assertions.');
});
