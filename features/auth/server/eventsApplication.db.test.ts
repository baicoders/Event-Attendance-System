import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { requestEventsAccess } from './eventsApplication';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
before(async () => { fixture = await createDisposableDb(); client = createTestClient(fixture.url); });
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('teacher can request the existing organizer approval without losing Class access', async () => {
  const user = await client.db.user.create({ data: { name: 'Teacher', email: 'events-applicant@example.test', password: 'test', role: 'MEMBER' } });
  await client.db.classroomMembership.create({ data: { userId: user.id, status: 'APPROVED', departmentOrDesignation: 'Faculty' } });
  const input = { commandId: randomUUID() }; const actor = { userId: user.id, credentialVersion: 0 };
  const result = await requestEventsAccess(client.db, actor, input);
  assert.equal(result.data.role, 'ORGANIZER'); assert.equal(result.data.status, 'PENDING');
  assert.equal((await client.db.classroomMembership.findUniqueOrThrow({ where: { userId: user.id } })).status, 'APPROVED');
  await client.db.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
  assert.equal((await requestEventsAccess(client.db, actor, input)).replayed, true);
  assert.equal((await client.db.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'ACTIVE');
  await assert.rejects(requestEventsAccess(client.db, actor, { commandId: randomUUID() }), { code: 'EVENTS_ALREADY_REQUESTED' });
});
test('request payload cannot select a role or another identity', async () => {
  await assert.rejects(async () => requestEventsAccess(client.db, { userId: 'attacker', credentialVersion: 0 }, { commandId: randomUUID(), role: 'ADMIN', userId: 'other' }), { name: 'ZodError' });
});
