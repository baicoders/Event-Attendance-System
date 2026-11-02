import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLimitedJson } from './requestBody';
test('bounded JSON accepts UTF-8 and rejects an oversized declared or streamed body', async () => {
  const valid = new Request('https://school.example/api/classroom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'José' }) });
  assert.deepEqual(await readLimitedJson(valid, 64), { name: 'José' });
  const declared = new Request('https://school.example/api/classroom', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '900' }, body: '{}' });
  await assert.rejects(readLimitedJson(declared, 64), { code: 'PAYLOAD_TOO_LARGE' });
  const streamed = new Request('https://school.example/api/classroom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'x'.repeat(128) }) });
  await assert.rejects(readLimitedJson(streamed, 64), { code: 'PAYLOAD_TOO_LARGE' });
});
test('non-JSON content and malformed JSON have explicit validation errors', async () => {
  await assert.rejects(readLimitedJson(new Request('https://school.example/api', { method: 'POST', body: '{}' })), { code: 'INVALID_REQUEST' });
  await assert.rejects(readLimitedJson(new Request('https://school.example/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })), { code: 'INVALID_REQUEST' });
});
