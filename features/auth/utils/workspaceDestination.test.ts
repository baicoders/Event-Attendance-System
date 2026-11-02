import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveWorkspaceDestination, readWorkspacePreference } from './workspaceDestination';
const teacher = { role: 'MEMBER', status: 'PENDING', accountState: 'ENABLED', classroomStatus: 'APPROVED' as const };
test('Class approval routes a teacher to a dedicated dashboard and keeps Events unavailable', () => {
  assert.equal(resolveWorkspaceDestination(teacher, 'CLASS'), '/class');
  assert.equal(resolveWorkspaceDestination(teacher, 'EVENTS'), '/account/events-access');
});
test('pending, rejected and suspended applicants only see their own status', () => {
  for (const classroomStatus of ['PENDING', 'REJECTED', 'SUSPENDED', 'REVOKED', null] as const) assert.equal(resolveWorkspaceDestination({ ...teacher, classroomStatus }, 'CLASS'), '/class/access');
});
test('dual users can select either workspace; Class suspension preserves Events destination', () => {
  const dual = { ...teacher, role: 'ORGANIZER', status: 'ACTIVE' };
  assert.equal(resolveWorkspaceDestination(dual, 'CLASS'), '/class');
  assert.equal(resolveWorkspaceDestination(dual, 'EVENTS'), '/dashboard');
  assert.equal(resolveWorkspaceDestination({ ...dual, classroomStatus: 'SUSPENDED' }, 'EVENTS'), '/dashboard');
});
test('forced-password and global restrictions override return destinations', () => {
  assert.equal(resolveWorkspaceDestination({ ...teacher, mustChangePassword: true }, 'CLASS', '/class/reports'), '/account/settings');
  assert.equal(resolveWorkspaceDestination({ ...teacher, accountState: 'DISABLED' }, 'CLASS'), '/account/settings');
  assert.equal(resolveWorkspaceDestination(null, 'CLASS'), '/login?workspace=CLASS');
});
test('returnTo is internal and authorized for the selected workspace', () => {
  assert.equal(resolveWorkspaceDestination(teacher, 'CLASS', '/class/classes/owned?tab=roster'), '/class/classes/owned?tab=roster');
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/students', '/class/admin/teachers', '/class/%2e%2e/admin']) assert.equal(resolveWorkspaceDestination(teacher, 'CLASS', target), '/class');
  const admin = { ...teacher, role: 'ADMIN', status: 'ACTIVE' };
  assert.equal(resolveWorkspaceDestination(admin, 'CLASS'), '/class/admin/teachers');
});
test('workspace query wins over remembered preference and invalid preferences are ignored', () => {
  assert.equal(readWorkspacePreference('?workspace=class', 'EVENTS'), 'CLASS');
  assert.equal(readWorkspacePreference('', 'CLASS'), 'CLASS');
  assert.equal(readWorkspacePreference('?workspace=administrator', 'forged'), 'EVENTS');
});
