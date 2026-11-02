import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {Pool} from 'pg';
import {createDisposableDb,createTestClient} from '../libs/testDb';
test('identifier upgrade preserves canonical IDs, history and employees, and unique identifiers reject duplicates', async () => {
  const fixture=await createDisposableDb('test_identifiers',{migrate:false});
  const pool=new Pool({connectionString:fixture.url});
  const client=createTestClient(fixture.url);
  try {
    // Apply the real historical prefix in an empty owned DB. Latest registry
    // views/triggers intentionally depend on identifiers and must not be dismantled.
    assert.equal((await pool.query(`SELECT to_regclass('"Student"') AS name`)).rows[0].name,null);
    for(const name of readdirSync('prisma/migrations').filter(name=>/^\d/.test(name)&&name<'20261023000100_student_identifiers').sort())await pool.query(readFileSync('prisma/migrations/'+name+'/migration.sql','utf8'));
    await pool.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('emp','Employees','employees','SECTION',NOW())`);
    for (const id of ['00000123456','00000123457','legacy-unclassified']) await pool.query(`INSERT INTO "Student" (id,"firstName","lastName","schoolLevel","yearLevel","updatedAt") VALUES ($1,'Synthetic','Student','COLLEGE','YEAR_1',NOW())`,[id]);
    await pool.query(`INSERT INTO "_GroupToStudent" ("A","B") VALUES ('emp','00000123457')`);
    await pool.query(`INSERT INTO "Event" (id,title,category,start,"end","updatedAt") VALUES ('historical-event','Fixture','ALL',now(),now(),now())`);
    await pool.query(`INSERT INTO "Record" (id,"eventId","studentId",method,"updatedAt") VALUES ('historical-record','historical-event','00000123456','SCANNED',now())`);
    const before=(await pool.query('SELECT id,"updatedAt" FROM "Student" ORDER BY id')).rows;
    await pool.query(readFileSync('prisma/migrations/20261023000100_student_identifiers/migration.sql','utf8'));
    assert.deepEqual((await pool.query('SELECT id,"updatedAt" FROM "Student" ORDER BY id')).rows,before);
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'00000123456'},select:{id:true,usn:true}})).usn,'00000123456');
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'00000123457'},select:{usn:true}})).usn,null);
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'legacy-unclassified'},select:{usn:true}})).usn,null);
    assert.equal((await pool.query(`SELECT "studentId" FROM "Record" WHERE id='historical-record'`)).rows[0].studentId,'00000123456');
    // The latest Prisma compiler fills newer defaults even with a narrow select;
    // historical writes must use the columns that actually existed at this boundary.
    const {rows:[partial]}=await pool.query(`INSERT INTO "Student" (id,"firstName","lastName",lrn,"updatedAt") VALUES ($1,'Synthetic','LRN','000000123456',now()) RETURNING id,usn,"schoolLevel","yearLevel"`,[randomUUID()]);
    assert.ok(partial.id);
    assert.equal(partial.usn,null); assert.equal(partial.schoolLevel,null); assert.equal(partial.yearLevel,null);
    await assert.rejects(pool.query(`INSERT INTO "Student" (id,"firstName","lastName",usn,"updatedAt") VALUES ('duplicate-usn','Duplicate','USN','00000123456',now())`),{code:'23505'});
    await assert.rejects(pool.query(`INSERT INTO "Student" (id,"firstName","lastName",lrn,"updatedAt") VALUES ('duplicate-lrn','Duplicate','LRN','000000123456',now())`),{code:'23505'});
    await assert.rejects(pool.query(`INSERT INTO "Student" (id,"firstName","lastName",lrn,"updatedAt") VALUES ('invalid-lrn','Invalid','LRN','123',now())`),{code:'23514'});
  } finally { await client.disconnect();await pool.end();await fixture.cleanup(); }
});
