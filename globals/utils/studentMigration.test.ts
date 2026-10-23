import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {createDisposableDb,createTestClient} from '../libs/testDb';
test('identifier upgrade preserves canonical IDs, history and employees, and unique identifiers reject duplicates', async () => {
  const fixture=await createDisposableDb('test_identifiers');
  const pool=new Pool({connectionString:fixture.url});
  const client=createTestClient(fixture.url);
  try {
    // Reconstruct a populated pre-upgrade Student table in this disposable DB.
    await pool.query('ALTER TABLE "Student" DROP COLUMN usn, DROP COLUMN lrn');
    await pool.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('emp','Employees','employees','SECTION',NOW())`);
    for (const id of ['00000123456','00000123457','legacy-unclassified']) await pool.query(`INSERT INTO "Student" (id,"firstName","lastName","schoolLevel","yearLevel","updatedAt") VALUES ($1,'Synthetic','Student','COLLEGE','YEAR_1',NOW())`,[id]);
    await pool.query(`INSERT INTO "_GroupToStudent" ("A","B") VALUES ('emp','00000123457')`);
    const event=await client.db.event.create({data:{title:'Fixture',category:'ALL',start:new Date(),end:new Date()}});
    const record=await client.db.record.create({data:{eventId:event.id,studentId:'00000123456',method:'SCANNED'}});
    const before=(await pool.query('SELECT id,"updatedAt" FROM "Student" ORDER BY id')).rows;
    await pool.query(readFileSync('prisma/migrations/20261023000100_student_identifiers/migration.sql','utf8'));
    assert.deepEqual((await pool.query('SELECT id,"updatedAt" FROM "Student" ORDER BY id')).rows,before);
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'00000123456'}})).usn,'00000123456');
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'00000123457'}})).usn,null);
    assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'legacy-unclassified'}})).usn,null);
    assert.equal((await client.db.record.findUniqueOrThrow({where:{id:record.id}})).studentId,'00000123456');
    const partial=await client.db.student.create({data:{firstName:'Synthetic',lastName:'LRN',lrn:'000000123456'}});
    assert.ok(partial.id);
    assert.equal(partial.usn,null); assert.equal(partial.schoolLevel,null); assert.equal(partial.yearLevel,null);
    await assert.rejects(client.db.student.create({data:{firstName:'Duplicate',lastName:'USN',usn:'00000123456'}}));
    await assert.rejects(client.db.student.create({data:{firstName:'Duplicate',lastName:'LRN',lrn:'000000123456'}}));
    await assert.rejects(client.db.student.create({data:{firstName:'Invalid',lastName:'LRN',lrn:'123'}}));
  } finally { await client.disconnect();await pool.end();await fixture.cleanup(); }
});
