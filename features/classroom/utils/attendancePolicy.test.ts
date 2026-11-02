import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAttendancePolicy,classifyClassroomArrival,validateSessionStart,suggestClassroomStart,schoolDate } from './attendancePolicy';
test('Manila lateness includes the exact grace boundary and never turns Late into Absent',()=>{
 const policy=buildAttendancePolicy('2026-11-02T08:00:00+08:00',15);
 assert.equal(policy.scheduledStartAt,'2026-11-02T00:00:00.000Z');assert.equal(policy.lateAfter,'2026-11-02T00:15:00.000Z');
 assert.equal(classifyClassroomArrival(policy,new Date('2026-11-02T00:15:00.000Z')),'PRESENT');
 assert.equal(classifyClassroomArrival(policy,new Date('2026-11-02T00:15:00.001Z')),'LATE');
 assert.equal(classifyClassroomArrival(buildAttendancePolicy('2026-11-02T00:00:00Z',0),new Date('2026-11-02T00:00:00Z')),'PRESENT');
 assert.equal(schoolDate(new Date('2026-11-01T18:00:00Z')),'2026-11-02');
});
test('start timestamps require an offset, valid term date and no more than five future minutes',()=>{
 const now=new Date('2026-11-02T00:00:00Z');const term={startDate:'2026-08-01',endDate:'2026-12-31'};
 assert.throws(()=>buildAttendancePolicy('2026-11-02T08:00:00',15),{code:'INVALID_TIMESTAMP'});
 assert.throws(()=>buildAttendancePolicy('2026-11-02T08:00:00+08:00',-1));
 assert.doesNotThrow(()=>validateSessionStart(buildAttendancePolicy('2026-11-02T00:05:00Z',0),term,now));
 assert.throws(()=>validateSessionStart(buildAttendancePolicy('2026-11-02T00:05:00.001Z',0),term,now),{code:'START_IN_FUTURE'});
 assert.throws(()=>validateSessionStart(buildAttendancePolicy('2026-07-31T08:00:00+08:00',15),term,now),{code:'START_OUTSIDE_TERM'});
 assert.doesNotThrow(()=>validateSessionStart(buildAttendancePolicy('2026-08-01T00:00:00+08:00',15),term,now));
});
test('suggestions use school timezone and a configured meeting day; no schedule uses server now',()=>{
 const now=new Date('2026-11-02T01:30:00Z');
 assert.equal(suggestClassroomStart(null,now),now.toISOString());
 assert.equal(suggestClassroomStart({v:1,days:[1],startTime:'08:00'},now),'2026-11-02T00:00:00.000Z');
 assert.equal(suggestClassroomStart({v:1,days:[2],startTime:'08:00'},now),now.toISOString());
});
