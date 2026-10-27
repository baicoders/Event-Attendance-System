import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusReadPaths, shouldPoll } from './traffic-policy.mjs';

test('operator manual saves refresh the active status list and written student before closing the panel',()=>{
  assert.deepEqual(statusReadPaths({screen:'operator',eventId:'event',manualOpen:true,selectedStudentId:'manual-student',writtenStudentId:'manual-student'}),[
    '/api/events/event/stats','/api/events/event/records?includeWithoutTimeIn=true','/api/records?eventId=event&studentId=manual-student',
  ]);
});

test('successful mutation refetches reset the eight-second polling clock and pending queries do not queue polls',()=>{
  assert.equal(shouldPoll(undefined,false,100),true);
  assert.equal(shouldPoll(1000,false,8999),false);
  assert.equal(shouldPoll(1000,false,9000),true);
  assert.equal(shouldPoll(8000,false,9000),false);
  assert.equal(shouldPoll(1000,true,30000),false);
});

test('regular QR saves do not refresh an unrelated manual selection; polling still does',()=>{
  const state={screen:'regular',eventId:'event',manualOpen:false,selectedStudentId:'manual-student'};
  assert.deepEqual(statusReadPaths({...state,writtenStudentId:'qr-student'}),[
    '/api/events/event/stats','/api/events/event/records','/api/events/event/records?includeWithoutTimeIn=true',
  ]);
  assert.deepEqual(statusReadPaths(state),[
    '/api/events/event/stats','/api/events/event/records','/api/events/event/records?includeWithoutTimeIn=true','/api/records?eventId=event&studentId=manual-student',
  ]);
  assert.deepEqual(statusReadPaths({...state,screen:'operator'}),['/api/events/event/stats']);
});
