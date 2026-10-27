import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDb, type DisposableDb } from '@/globals/libs/testDb';
import { recordAttendance } from './recordAttendance';

const statements: string[] = [];
function loggedClient(pool: Pool) {
  const client=new PrismaClient({adapter:new PrismaPg(pool),log:[{emit:'event',level:'query'}]});
  client.$on('query',event=>statements.push(event.query));
  return client;
}
let fixture: DisposableDb;
let pool: Pool;
let db: ReturnType<typeof loggedClient>;
let actor: {id:string;role:'ORGANIZER';credentialVersion:number};
let eventId: string;
let studentId: string;
before(async()=>{
  fixture=await createDisposableDb('test_attendance_performance');
  pool=new Pool({connectionString:fixture.url,max:3});
  db=loggedClient(pool);
  const user=await db.user.create({data:{name:'Current Operator',email:'perf@example.test',password:'synthetic',status:'ACTIVE'}});
  actor={id:user.id,role:'ORGANIZER',credentialVersion:0};
  const student=await db.student.create({data:{firstName:'Ana',middleName:'M',lastName:'Cruz',usn:'26000000001',schoolLevel:'COLLEGE'}});
  studentId=student.id;
  const event=await db.event.create({data:{title:'Current Event',category:'ALL',status:'APPROVED',createdById:user.id,start:new Date(),end:new Date()}});
  eventId=event.id;
});
after(async()=>{await db?.$disconnect();await pool?.end();await fixture?.cleanup();});

test('a fresh attendance write obtains audit labels from the locked reads without three extra queries',async()=>{
  statements.length=0;
  const result=await recordAttendance(db,{eventId,studentId,method:'SCANNED',expectedMode:'TIME_IN'},actor);
  const sql=statements.slice();
  // Identity resolution + eligibility; no third Student SELECT just for its audit label.
  assert.equal(sql.filter(query=>query.includes('FROM "public"."Student"')).length,2,sql.join('\n'));
  assert.equal(sql.filter(query=>query.includes('FROM "public"."Event"')).length,1,sql.join('\n'));
  assert.equal(sql.filter(query=>query.includes('FROM "public"."User"')).length,1,sql.join('\n'));
  const changes=await db.attendanceChange.findMany({where:{recordId:result.record.id}});
  assert.equal(changes.length,1);
  assert.equal(changes[0].actorName,'Current Operator');
  assert.equal(changes[0].eventTitle,'Current Event');
  assert.equal(changes[0].studentLabel,'Ana M Cruz');
  assert.equal(changes[0].action,'CREATE');
  assert.equal((changes[0].after as {revision:number}).revision,1);
});

test('duplicate scans return the first record without a second Record SELECT or audit write',async()=>{
  const input={eventId,studentId,method:'SCANNED' as const,expectedMode:'TIME_IN' as const};
  const first=await recordAttendance(db,input,actor);
  statements.length=0;
  const duplicate=await recordAttendance(db,input,actor);
  const sql=statements.slice();
  assert.equal(duplicate.changed,false);
  assert.deepEqual(duplicate.record,first.record);
  assert.equal(sql.filter(query=>query.includes('FROM "public"."Record"')).length,1,sql.join('\n'));
  assert.equal(await db.attendanceChange.count({where:{recordId:first.record.id}}),1);
});

test('time-out audit labels use current locked state while preserving the original time-in audit',async()=>{
  await db.user.update({where:{id:actor.id},data:{name:'Renamed Operator'}});
  await db.student.update({where:{id:studentId},data:{lastName:'Santos'}});
  await db.event.update({where:{id:eventId},data:{title:'Renamed Event',isTimeout:true}});
  const result=await recordAttendance(db,{eventId,studentId,method:'MANUAL',expectedMode:'TIME_OUT'},actor);
  const audit=await db.attendanceChange.findMany({where:{recordId:result.record.id},orderBy:{id:'asc'}});
  assert.equal(audit.length,2);
  assert.equal(audit[0].actorName,'Current Operator');
  assert.equal(audit[0].eventTitle,'Current Event');
  assert.equal(audit[0].studentLabel,'Ana M Cruz');
  assert.equal(audit[1].actorName,'Renamed Operator');
  assert.equal(audit[1].eventTitle,'Renamed Event');
  assert.equal(audit[1].studentLabel,'Ana M Santos');
  assert.equal(audit[1].action,'TIME_OUT');
  assert.equal((audit[1].before as {timein:string}).timein,(audit[1].after as {timein:string}).timein);
  statements.length=0;
  const repeated=await recordAttendance(db,{eventId,studentId,method:'MANUAL',expectedMode:'TIME_OUT'},actor);
  const repeatedSql=statements.slice();
  assert.equal(repeated.changed,false);
  assert.deepEqual(repeated.record,result.record);
  assert.equal(repeatedSql.filter(query=>query.includes('FROM "public"."Record"')).length,1);
});
