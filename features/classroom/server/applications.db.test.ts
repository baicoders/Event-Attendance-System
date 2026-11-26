import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { saveTeacherApplication, reviewTeacherApplication } from './applications';
import { executeClassroomCommand } from './commands';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
const applicantId = 'class-applicant';
const adminId = 'class-admin';
const actor = { userId: applicantId, credentialVersion: 0 };
const admin = { userId: adminId, credentialVersion: 0 };
const application = () => ({ commandId: randomUUID(), action: 'SUBMIT' as const, departmentOrDesignation: 'Computer Studies', applicationText: 'Teaching Programming 2' });
before(async () => {
  fixture = await createDisposableDb(); client = createTestClient(fixture.url);
  await client.db.user.createMany({ data: [
    { id: applicantId, name: 'New Teacher', email: 'teacher@example.test', password: 'test', role: 'MEMBER', status: 'PENDING' },
    { id: adminId, name: 'Admin', email: 'admin@example.test', password: 'test', role: 'ADMIN', status: 'ACTIVE' },
  ] });
});
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('applicant can submit and replay without approval; no Events permissions change', async () => {
  const input = application();
  const first = await saveTeacherApplication(client.db, actor, input);
  const replay = await saveTeacherApplication(client.db, actor, input);
  assert.equal(first.data.status, 'PENDING'); assert.equal(replay.replayed, true);
  assert.equal(await client.db.classroomMembership.count({ where: { userId: applicantId } }), 1);
  const user = await client.db.user.findUniqueOrThrow({ where: { id: applicantId } });
  assert.equal(user.role, 'MEMBER'); assert.equal(user.status, 'PENDING');
  assert.equal(await client.db.classroomAudit.count({ where: { entityId: applicantId } }), 1);
});
test('same command key with another payload is rejected and does not change application', async () => {
  const input = { ...application(), expectedRevision: 0, action: 'SAVE' as const };
  await saveTeacherApplication(client.db, actor, input);
  await assert.rejects(saveTeacherApplication(client.db, actor, { ...input, applicationText: 'Different' }), { code: 'COMMAND_REUSED' });
});
test('concurrent administrators can make exactly one decision for one revision', async () => {
  const member = await client.db.classroomMembership.findUniqueOrThrow({ where: { userId: applicantId } });
  const results = await Promise.allSettled([
    reviewTeacherApplication(client.db, admin, applicantId, { commandId: randomUUID(), expectedRevision: member.revision, action: 'APPROVE' }),
    reviewTeacherApplication(client.db, admin, applicantId, { commandId: randomUUID(), expectedRevision: member.revision, action: 'REJECT', reason: 'Duplicate review' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const fresh = await client.db.user.findUniqueOrThrow({ where: { id: applicantId } });
  assert.equal(fresh.role, 'MEMBER'); assert.equal(fresh.status, 'PENDING');
});
test('Class suspension preserves a separately held organizer approval', async () => {
  const user = await client.db.user.create({ data: { name: 'Dual', email: 'dual@example.test', password: 'test', status: 'ACTIVE' } });
  const dual = { userId: user.id, credentialVersion: 0 };
  const result = await saveTeacherApplication(client.db, dual, application());
  const approval = await reviewTeacherApplication(client.db, admin, user.id, { commandId: randomUUID(), expectedRevision: result.data.revision, action: 'APPROVE' });
  await reviewTeacherApplication(client.db, admin, user.id, { commandId: randomUUID(), expectedRevision: approval.data.revision, action: 'SUSPEND', reason: 'Investigation' });
  assert.equal((await client.db.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'ACTIVE');
  await assert.rejects(executeClassroomCommand(client.db, dual, 'APPROVED_CLASSROOM', { commandId: randomUUID(), operation: 'TEST', resourceId: user.id, payload: {} }, async () => ({ allowed: true })), { code: 'CLASSROOM_SUSPENDED' });
});
test('commands are atomic and audit rows cannot be updated or deleted', async () => {
  const key = randomUUID();
  await assert.rejects(executeClassroomCommand(client.db, admin, 'ADMIN', { commandId: key, operation: 'FAIL_TEST', resourceId: adminId, payload: {} }, async tx => {
    await tx.classroomAudit.create({ data: { action: 'FAIL_TEST', entityType: 'User', entityId: adminId, actorId: adminId, actorName: 'Admin', commandId: key, after: { test: true } } });
    throw new Error('Simulated domain failure');
  }), /Simulated domain failure/);
  assert.equal(await client.db.classroomCommandReceipt.count({ where: { commandId: key } }), 0);
  assert.equal(await client.db.classroomAudit.count({ where: { commandId: key } }), 0);
  const audit = await client.db.classroomAudit.findFirstOrThrow();
  await assert.rejects(client.db.classroomAudit.update({ where: { id: audit.id }, data: { reason: 'tampered' } }));
  await assert.rejects(client.db.classroomAudit.delete({ where: { id: audit.id } }));
});

test('suspension waits for authorized writes and denies every following Class command', async () => {
  const teacher = await client.db.user.create({ data: { name: 'Concurrent Teacher', email: 'concurrent@example.test', password: 'test', role: 'MEMBER' } });
  await client.db.classroomMembership.create({ data: { userId: teacher.id, status: 'APPROVED', departmentOrDesignation: 'Faculty' } });
  const principal = { userId: teacher.id, credentialVersion: 0 };
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const write = executeClassroomCommand(client.db, principal, 'APPROVED_CLASSROOM', { commandId: randomUUID(), operation: 'AUTHORIZED_WRITE', resourceId: teacher.id, payload: {} }, async () => { entered(); await gate; return { saved: true }; });
  await started;
  const suspension = reviewTeacherApplication(client.db, admin, teacher.id, { commandId: randomUUID(), action: 'SUSPEND', expectedRevision: 0, reason: 'Concurrent suspension' });
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await client.db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%User%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, 'suspension must queue on the protected User row');
  } finally { release(); }
  assert.equal((await write).data.saved, true);
  await suspension;
  await assert.rejects(executeClassroomCommand(client.db, principal, 'APPROVED_CLASSROOM', { commandId: randomUUID(), operation: 'AFTER_SUSPENSION', resourceId: teacher.id, payload: {} }, async () => ({ saved: true })), { code: 'CLASSROOM_SUSPENDED' });
});
