import 'server-only';
import { Prisma } from '@prisma/client';
import { studentSchema } from '@/globals/schemas/studentSchema';
import { IMPORT_GROUP_FIELDS, type ImportReview } from './contract';
import { ImportError } from './errors';

export const DEFAULT_IMPORT_BATCH_SIZE = 250;

/** Bounded statements on the caller's locked transaction. No independent commits. */
export async function writeImportBatches(tx: Prisma.TransactionClient, review: ImportReview, batchSize = DEFAULT_IMPORT_BATCH_SIZE) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Import batch size must be between 1 and 1000.');
  if (review.rows.some(row => row.status === 'BLOCKED')) throw new ImportError('Blocked imports cannot commit.', 'IMPORT_BLOCKED', 409);
  const changed = review.rows.filter(row => row.status !== 'UNCHANGED');
  for (let offset = 0; offset < changed.length; offset += batchSize) {
    const batch = changed.slice(offset, offset + batchSize).map(row => ({
      row,
      student: studentSchema.parse({ ...row.student, schoolLevel: row.student.schoolLevel || null, yearLevel: row.student.yearLevel || null }),
    }));
    const scalars = ({ student }: typeof batch[number]) => ({
      usn: student.usn || null, lrn: student.lrn || null, firstName: student.firstName,
      lastName: student.lastName, middleName: student.middleName || null,
      schoolLevel: student.schoolLevel ?? null, yearLevel: student.yearLevel ?? null,
    });
    const creates = batch.filter(item => item.row.status === 'CREATE');
    if (creates.length) {
      // Return order is unspecified. Resolve generated IDs by exact identifiers.
      const saved = await tx.student.createManyAndReturn({ data: creates.map(scalars), select: { id: true, usn: true, lrn: true } });
      const ids = new Map(saved.flatMap(student => [student.usn, student.lrn].filter((code): code is string => !!code).map(code => [code, student.id] as const)));
      for (const item of creates) {
        const id = ids.get(item.student.usn || item.student.lrn!);
        if (!id) throw new Error('Created import identity could not be resolved.');
        item.row.student.id = id;
      }
    }
    const updates = batch.filter(item => item.row.status === 'UPDATE');
    if (updates.length) {
      const values = updates.map(item => ({ id: item.row.student.id, ...scalars(item) }));
      // Parameters remain JSON data. PostgreSQL enforces the same enum/FK/unique
      // constraints; updatedAt is explicit because raw SQL bypasses Prisma's hook.
      const count = await tx.$executeRaw(Prisma.sql`
        UPDATE "Student" AS s SET "usn"=v."usn", "lrn"=v."lrn",
          "firstName"=v."firstName", "lastName"=v."lastName", "middleName"=v."middleName",
          "schoolLevel"=v."schoolLevel", "yearLevel"=v."yearLevel", "updatedAt"=${new Date()}
        FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS v(
          "id" text, "usn" text, "lrn" text, "firstName" text, "lastName" text,
          "middleName" text, "schoolLevel" "SchoolLevel", "yearLevel" "YearLevel")
        WHERE s."id"=v."id"
      `);
      if (count !== updates.length) throw new Error('An import update target disappeared.');
    }
    const membershipRows = batch.filter(item => item.row.status === 'CREATE' || item.row.changes.some(change => change.field in IMPORT_GROUP_FIELDS));
    const replaceIds = membershipRows.filter(item => item.row.status === 'UPDATE').map(item => item.row.student.id);
    if (replaceIds.length) await tx.$executeRaw(Prisma.sql`DELETE FROM "_GroupToStudent" WHERE "B" IN (${Prisma.join(replaceIds)})`);
    const memberships = membershipRows.flatMap(({ row }) => row.groupIds.map(groupId => ({ groupId, studentId: row.student.id })));
    if (memberships.length) await tx.$executeRaw(Prisma.sql`
      INSERT INTO "_GroupToStudent" ("A", "B")
      SELECT v."groupId", v."studentId" FROM jsonb_to_recordset(${JSON.stringify(memberships)}::jsonb) AS v("groupId" text, "studentId" text)
    `);
  }
}
