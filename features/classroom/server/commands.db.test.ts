import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { executeClassroomCommand } from './commands';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
let id: string;
before(async () => { fixture = await createDisposableDb(); client = createTestClient(fixture.url); id = (await client.db.user.create({ data: { name: 'Organizer', email: 'commands@example.test', password: 'test', status: 'ACTIVE' } })).id; });
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('UUID casing and identical payload replay one result; path or payload changes reject', async () => {
  const commandId = randomUUID(); const actor = { userId: id, credentialVersion: 0 };
  const input = { commandId, operation: 'EVENTS_DIRECTORY_EDIT', resourceId: id, payload: { name: 'Updated' } };
  const first = await executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', input, async () => ({ revision: 1 }));
  const replay = await executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', { ...input, commandId: commandId.toUpperCase() }, async () => { throw new Error('Must not execute twice'); });
  assert.deepEqual(replay.data, first.data); assert.equal(replay.replayed, true);
  await assert.rejects(executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', { ...input, resourceId: 'other' }, async () => ({})), { code: 'COMMAND_REUSED' });
  await assert.rejects(executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', { ...input, payload: { name: 'Wrong' } }, async () => ({})), { code: 'COMMAND_REUSED' });
  assert.equal(await client.db.classroomCommandReceipt.count({ where: { commandId } }), 1);
});
test('different actors may safely use the same UUID', async () => {
  const other = await client.db.user.create({ data: { name: 'Another', email: 'othercommands@example.test', password: 'test', status: 'ACTIVE' } });
  const commandId = randomUUID();
  for (const userId of [id, other.id]) {
    const result = await executeClassroomCommand(client.db, { userId, credentialVersion: 0 }, 'EVENTS_DIRECTORY', { commandId, operation: 'EDIT', resourceId: userId, payload: {} }, async () => ({ owner: userId }));
    assert.equal(result.data.owner, userId); assert.equal(result.replayed, false);
  }
  assert.equal(await client.db.classroomCommandReceipt.count({ where: { commandId } }), 2);
});
test('replay reauthorizes the resource and credential generation before returning private data', async () => {
  const actor = { userId: id, credentialVersion: 0 };
  const input = { commandId: randomUUID(), operation: 'PRIVATE_RESULT', resourceId: id, payload: {} };
  await executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', input, async () => ({ confidential: 'Private receipt' }));
  await assert.rejects(executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', input, async () => ({}), { authorizeResource: async () => { throw Object.assign(new Error('Ownership changed'), { code: 'CLASS_NOT_FOUND' }); } }), { code: 'CLASS_NOT_FOUND' });
  await client.db.user.update({ where: { id }, data: { credentialVersion: { increment: 1 } } });
  await assert.rejects(executeClassroomCommand(client.db, actor, 'EVENTS_DIRECTORY', input, async () => ({})), { code: 'UNAUTHORIZED' });
});
