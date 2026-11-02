import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { recordAttendance } from '@/features/attendance/server/recordAttendance';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
before(async () => { fixture = await createDisposableDb(); client = createTestClient(fixture.url); });
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('stale Events actor cannot scan after global disable or loss of Events role', async () => {
  const user = await client.db.user.create({ data: { name: 'Organizer', email: 'stale@example.test', password: 'test', role: 'ORGANIZER', status: 'ACTIVE' } });
  const student = await client.db.student.create({ data: { firstName: 'Private', lastName: 'Student', usn: '00000123456' } });
  const event = await client.db.event.create({ data: { title: 'Private Event', category: 'ALL', status: 'APPROVED', start: new Date(), end: new Date(Date.now() + 3600000), createdById: user.id } });
  const actor = { id: user.id, role: 'ORGANIZER' as const, credentialVersion: 0 };
  await client.db.user.update({ where: { id: user.id }, data: { accountState: 'DISABLED' } });
  await assert.rejects(recordAttendance(client.db, { eventId: event.id, studentId: student.usn!, method: 'SCANNED' }, actor), { code: 'UNAUTHORIZED' });
  await client.db.user.update({ where: { id: user.id }, data: { accountState: 'ENABLED', role: 'MEMBER' } });
  await assert.rejects(recordAttendance(client.db, { eventId: event.id, studentId: student.usn!, method: 'SCANNED' }, actor), { code: 'UNAUTHORIZED' });
  assert.equal(await client.db.record.count({ where: { eventId: event.id } }), 0);
});
