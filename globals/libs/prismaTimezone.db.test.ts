import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createDisposableDb,createTestClient } from './testDb';
import { getPgPoolConfig } from './dbConfig';
test('Prisma UTC instants round-trip physically unchanged under a Manila database default',async()=>{
 const fixture=await createDisposableDb();let client:ReturnType<typeof createTestClient>|undefined;
 const setup=new Pool(getPgPoolConfig(fixture.url));
 try{
  await setup.query(`ALTER DATABASE "${fixture.dbName}" SET timezone TO 'Asia/Manila'`);
  client=createTestClient(fixture.url);
  const instant=new Date('2026-08-03T00:15:00.123Z');
  const student=await client.db.student.create({data:{id:'utc-roundtrip',firstName:'Timestamp',lastName:'Fixture',createdAt:instant}});
  assert.equal(student.createdAt.toISOString(),instant.toISOString());
  const physical=await setup.query(`SELECT to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS')||'Z' AS instant FROM "Student" WHERE id=$1`,[student.id]);
  assert.equal(physical.rows[0].instant,instant.toISOString());
  assert.deepEqual(await client.db.$queryRaw`SHOW timezone`,[{TimeZone:'UTC'}]);
 }finally{await client?.disconnect();await setup.end();await fixture.cleanup();}
});
