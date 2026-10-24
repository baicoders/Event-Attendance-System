import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDb } from '../../../globals/libs/testDb';
import { previewStudentImport, commitStudentImport } from './server';
import { resolveImportBatchSize } from './writeBatches';

test('batch size configuration accepts only bounded whole numbers', () => {
  assert.equal(resolveImportBatchSize(undefined), 250);
  assert.equal(resolveImportBatchSize('100'), 100);
  assert.equal(resolveImportBatchSize('1000'), 1000);
  for (const value of ['', '0', '-1', '1001', '1.5', 'NaN']) assert.throws(() => resolveImportBatchSize(value));
});

test('100 grouped students commit with bounded queries and replay without rewriting identities', async () => {
  const fixture = await createDisposableDb('test_import_batches');
  const pool = new Pool({ connectionString: fixture.url, max: 2 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
  let queries = 0;
  db.$on('query', () => { queries++; });
  try {
    const actor = await db.user.create({ data: { name: 'Synthetic Admin', email: 'batch@example.test', password: 'fixture', role: 'ADMIN', status: 'ACTIVE' } });
    await db.group.createMany({ data: [
      { id: 'house', slug: 'house', name: 'House', category: 'HOUSE' },
      { id: 'section', slug: 'section', name: 'Section', category: 'SECTION' },
    ] });
    const csv = 'usn,firstName,lastName,house,section\n' + Array.from({ length: 100 }, (_, i) => `${String(i).padStart(11, '0')},Synthetic,Student,house,section`).join('\n');
    const input = { v: 2 as const, fileName: 'synthetic.csv', csv, sourceHash: createHash('sha256').update(csv).digest('hex') };
    const preview = await previewStudentImport(db, input, actor);
    assert.equal(preview.counts.create, 100);
    queries = 0;
    const command = { ...input, previewToken: preview.previewToken!, commandId: randomUUID() };
    const progress: { processed: number; total: number; batch: number; batches: number }[] = [];
    const result = await commitStudentImport(db, command, actor, update => { progress.push(update); });
    const commitQueries = queries;
    assert.equal(result.receipt.counts.create, 100);
    assert.ok(progress.length >= 2);
    assert.deepEqual(progress.at(-1), { processed: 100, total: 100, batch: 1, batches: 1 });
    const saved = await db.student.findMany({ include: { groups: true } });
    assert.equal(saved.length, 100);
    assert.ok(saved.every(student => student.groups.length === 2 && student.id !== student.usn));
    const before = saved.map(student => [student.id, student.updatedAt.toISOString()]).sort();
    assert.equal((await commitStudentImport(db, command, actor)).replayed, true);
    const repeated = await previewStudentImport(db, input, actor);
    assert.equal(repeated.counts.unchanged, 100);
    await commitStudentImport(db, { ...input, previewToken: repeated.previewToken!, commandId: randomUUID() }, actor);
    assert.deepEqual((await db.student.findMany()).map(student => [student.id, student.updatedAt.toISOString()]).sort(), before);
    assert.ok(commitQueries <= 50, `100 grouped creates required ${commitQueries} queries; expected at most 50`);
  } finally {
    await db.$disconnect();
    await pool.end();
    await fixture.cleanup();
  }
});

test('mixed batch updates preserve omitted data, custom positions, attendance and QR IDs; late failure rolls back all batches', async () => {
  const fixture = await createDisposableDb('test_import_batch_integrity');
  const pool = new Pool({ connectionString: fixture.url, max: 2 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const actor = await db.user.create({ data: { name: 'Synthetic Admin', email: 'mixed@example.test', password: 'fixture', role: 'ADMIN', status: 'ACTIVE' } });
    await db.group.createMany({ data: [
      { id: 'house', slug: 'house', name: 'House', category: 'HOUSE' },
      { id: 'section', slug: 'section', name: 'Section', category: 'SECTION' },
      { id: 'section-new', slug: 'section-new', name: 'New Section', category: 'SECTION' },
      { id: 'guild', slug: 'guild', name: 'Guild', category: 'CUSTOM' },
    ] });
    const csv = 'usn,firstName,lastName,house,section,schoolLevel,yearLevel\n' + Array.from({ length: 100 }, (_, i) => `${String(i).padStart(11, '0')},Synthetic,Student,house,section,COLLEGE,YEAR_1`).join('\n');
    const source = (csv: string) => ({ v: 2 as const, fileName: 'synthetic.csv', csv, sourceHash: createHash('sha256').update(csv).digest('hex') });
    const run = async (csv: string) => {
      const input = source(csv);
      const preview = await previewStudentImport(db, input, actor);
      return commitStudentImport(db, { ...input, previewToken: preview.previewToken!, commandId: randomUUID() }, actor);
    };
    await run(csv);
    const saved = await db.student.findMany({ orderBy: { usn: 'asc' } });
    const target = saved[0];
    const custom = await db.customGroupMembership.create({ data: { studentId: target.id, groupId: 'guild', position: 'President' } });
    const event = await db.event.create({ data: { title: 'Synthetic', category: 'ALL', start: new Date(), end: new Date() } });
    const attendance = await db.record.create({ data: { eventId: event.id, studentId: target.id, method: 'SCANNED' } });
    const mixed = 'usn,lrn,firstName,lastName,section,yearLevel\n' + saved.map((student, i) => `${student.usn},${i < 50 ? String(i).padStart(12, '0') : ''},Synthetic,Student,${i >= 50 && i < 75 ? 'section-new' : ''},${i < 50 ? 'YEAR_2' : ''}`).join('\n');
    assert.deepEqual((await run(mixed)).receipt.counts, { total: 100, create: 0, update: 75, unchanged: 25, blocked: 0 });
    const after = await db.student.findMany({ orderBy: { usn: 'asc' }, include: { groups: true } });
    assert.deepEqual(after.map(s => s.id), saved.map(s => s.id));
    assert.ok(after.every(s => s.groups.some(g => g.id === 'house') && s.schoolLevel === 'COLLEGE'));
    assert.ok(after.slice(0, 50).every(s => s.groups.some(g => g.id === 'section') && s.yearLevel === 'YEAR_2'));
    assert.ok(after.slice(50, 75).every(s => s.groups.some(g => g.id === 'section-new')));
    assert.deepEqual(after.slice(75).map(s => s.updatedAt), saved.slice(75).map(s => s.updatedAt));
    assert.deepEqual(await db.customGroupMembership.findUnique({ where: { studentId: target.id } }), custom);
    assert.deepEqual(await db.record.findUnique({ where: { id: attendance.id } }), attendance);
    const beforeFailure = await db.student.findMany({ orderBy: { usn: 'asc' } });
    const receipts = await db.studentImportBatch.count();
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_last_import_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.usn = '99999999999' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER reject_last_import_batch BEFORE INSERT ON "Student" FOR EACH ROW EXECUTE FUNCTION reject_last_import_batch()');
    const failing = 'usn,firstName,lastName\n' + Array.from({ length: 501 }, (_, i) => `${i === 500 ? '99999999999' : String(1000 + i).padStart(11, '0')},Synthetic,Student`).join('\n');
    await assert.rejects(run(failing), { code: 'IMPORT_REJECTED' });
    assert.deepEqual(await db.student.findMany({ orderBy: { usn: 'asc' } }), beforeFailure);
    assert.equal(await db.studentImportBatch.count(), receipts);
    assert.deepEqual(await db.customGroupMembership.findUnique({ where: { studentId: target.id } }), custom);
    assert.deepEqual(await db.record.findUnique({ where: { id: attendance.id } }), attendance);
  } finally {
    await db.$disconnect(); await pool.end(); await fixture.cleanup();
  }
});
