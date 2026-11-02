import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestOriginProblem } from './requestOrigin';
const request = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://school.example/api/students', { method, headers });
test('cross-origin and cross-site mutation requests are denied even with an auth cookie', () => {
  assert.equal(requestOriginProblem(request({ origin: 'https://evil.example', cookie: 'event-attendance-auth=held' })), 'CROSS_SITE_REQUEST');
  assert.equal(requestOriginProblem(request({ 'sec-fetch-site': 'cross-site' })), 'CROSS_SITE_REQUEST');
});
test('same-origin mutations and safe reads work', () => {
  assert.equal(requestOriginProblem(request({ origin: 'https://school.example', cookie: 'event-attendance-auth=held' })), null);
  assert.equal(requestOriginProblem(request({ cookie: 'event-attendance-auth=held' }, 'GET')), null);
});
test('cookie-authenticated clients without Origin need same-origin metadata or a CSRF token', () => {
  assert.equal(requestOriginProblem(request({ cookie: 'event-attendance-auth=held' })), 'CSRF_TOKEN_REQUIRED');
  assert.equal(requestOriginProblem(request({ cookie: 'event-attendance-auth=held', 'sec-fetch-site': 'same-origin' })), null);
  const token = 'a'.repeat(64);
  assert.equal(requestOriginProblem(request({ cookie: `event-attendance-auth=held; school-csrf=${token}`, 'x-csrf-token': token })), null);
  assert.equal(requestOriginProblem(request({ cookie: `event-attendance-auth=held; school-csrf=${token}`, 'x-csrf-token': 'b'.repeat(64) })), 'CSRF_TOKEN_REQUIRED');
});
test('forwarded-host cannot authorize a forged origin', () => {
  assert.equal(requestOriginProblem(request({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' })), 'CROSS_SITE_REQUEST');
});
test('Next internal localhost URL does not reject the same public Host origin', () => {
  const req = new Request('http://localhost:43000/api/students', { method: 'POST', headers: { host: '127.0.0.1:43000', origin: 'http://127.0.0.1:43000', cookie: 'event-attendance-auth=held' } });
  assert.equal(requestOriginProblem(req), null);
  assert.equal(requestOriginProblem(req, ['https://school.example']), 'CROSS_SITE_REQUEST');
});
