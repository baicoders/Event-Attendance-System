import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceCapabilities } from './accessPolicy';

const identity = { role: 'MEMBER', status: 'PENDING', accountState: 'ENABLED', mustChangePassword: false } as const;
test('teacher-only approval never grants Events access', () => {
  assert.deepEqual(workspaceCapabilities(identity, 'APPROVED'), { events: false, classroom: true, admin: false });
});
test('pending, rejected, suspended and revoked applicants have identity access only', () => {
  for (const status of ['PENDING', 'REJECTED', 'SUSPENDED', 'REVOKED', null] as const) {
    assert.deepEqual(workspaceCapabilities(identity, status), { events: false, classroom: false, admin: false });
  }
});
test('dual membership combines grants and Class suspension preserves Events', () => {
  const organizer = { ...identity, role: 'ORGANIZER', status: 'ACTIVE' } as const;
  assert.deepEqual(workspaceCapabilities(organizer, 'APPROVED'), { events: true, classroom: true, admin: false });
  assert.deepEqual(workspaceCapabilities(organizer, 'SUSPENDED'), { events: true, classroom: false, admin: false });
});
test('rejected organizer may separately be an approved teacher', () => {
  assert.deepEqual(workspaceCapabilities({ ...identity, role: 'ORGANIZER', status: 'REJECTED' }, 'APPROVED'), { events: false, classroom: true, admin: false });
});
test('global disable and forced password gate block both workspaces', () => {
  const admin = { ...identity, role: 'ADMIN', status: 'ACTIVE' } as const;
  for (const restricted of [{ ...admin, accountState: 'DISABLED' }, { ...admin, mustChangePassword: true }]) {
    assert.deepEqual(workspaceCapabilities(restricted, 'APPROVED'), { events: false, classroom: false, admin: false });
  }
});
test('only an enabled active administrator can assist across both workspaces', () => {
  assert.deepEqual(workspaceCapabilities({ ...identity, role: 'ADMIN', status: 'ACTIVE' }, null), { events: true, classroom: true, admin: true });
  assert.deepEqual(workspaceCapabilities({ ...identity, role: 'ADMIN', status: 'REJECTED' }, null), { events: false, classroom: false, admin: false });
});
