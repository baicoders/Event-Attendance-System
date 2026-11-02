import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@/globals/utils/api';
import { definitiveCommandFailure } from './commandFailure';
test('a malformed successful acknowledgment remains unconfirmed and retains its command key',()=>{
  for(const error of [new Error('Connection lost'),new ApiError('Invalid server response',200),new ApiError('Gateway unavailable',502)])assert.equal(definitiveCommandFailure(error),false);
  assert.equal(definitiveCommandFailure(new ApiError('Roster changed',409,'ROSTER_CHANGED')),true);
  assert.equal(definitiveCommandFailure(new ApiError('Forbidden',403)),true);
});
