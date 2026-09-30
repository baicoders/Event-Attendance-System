import test from 'node:test';
import assert from 'node:assert/strict';

test('import review token is purpose-bound, strict, actor-bound and expires', async () => {
  const token = await import('./token').catch(() => null);
  assert.ok(token, 'import review signing service must exist');
  const now = Date.now();
  const payload = { v: 1 as const, purpose: 'student-import-review-v1' as const, actorId: 'admin', sourceHash: 'a'.repeat(64), normalizedInputHash: 'b'.repeat(64), reviewHash: 'c'.repeat(64), fileName: 'master.csv', preparedAt: now, expiresAt: now+600000 };
  const signed = token.signImportToken(payload);
  assert.deepEqual(token.verifyImportToken(signed, 'admin'), payload);
  const tampered = signed.slice(0, -1) + (signed.endsWith('0') ? '1' : '0');
  for (const invalid of [signed+'x', signed+'.extra', tampered, 'bad']) assert.throws(() => token.verifyImportToken(invalid, 'admin'));
  assert.throws(() => token.verifyImportToken(signed, 'other'));
  assert.throws(() => token.verifyImportToken(token.signImportToken({...payload,expiresAt:Date.now()-1}), 'admin'));
  assert.throws(() => token.verifyImportToken(token.signImportToken({...payload,purpose:'student-bulk-commit-v1'} as never), 'admin'));
});

test('bounded body reader measures streamed bytes without trusting Content-Length', async () => {
  const http = await import('./body').catch(() => null);
  assert.ok(http, 'bounded HTTP reader must exist');
  assert.deepEqual(await http.readImportBody(new Request('http://test', {method:'POST',body:'{"x":1}'}), 20), {x:1});
  await assert.rejects(http.readImportBody(new Request('http://test',{method:'POST',body:' '.repeat(21)}),20), /large/i);
  await assert.rejects(http.readImportBody(new Request('http://test',{method:'POST',body:'{"x":'}),20), /JSON/i);
});

test('review fingerprint binds absent students, membership identities and Group names', async () => {
  const state = await import('./stateHash').catch(() => null);
  assert.ok(state, 'review state hashing must exist');
  const rows = [{csvRow:2,student:{id:'00000123456'}}];
  const group = {id:'sec',slug:'s',name:'Section',category:'SECTION'};
  const student = {id:'00000123456',firstName:'A',lastName:'B',middleName:null,schoolLevel:'COLLEGE',yearLevel:'YEAR_1',createdAt:new Date(0),updatedAt:new Date(0),groups:[group]};
  const hash = state.hashImportReview(rows as never,[student] as never,[group]);
  assert.equal(hash,state.hashImportReview(rows as never,[student] as never,[group]));
  assert.notEqual(hash,state.hashImportReview(rows as never,[] as never,[group]));
  assert.notEqual(hash,state.hashImportReview(rows as never,[student] as never,[{...group,name:'Renamed'}]));
  assert.notEqual(hash,state.hashImportReview(rows as never,[{...student,groups:[{...group,id:'new'}]}] as never,[group]));
});
