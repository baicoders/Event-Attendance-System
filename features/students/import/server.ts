import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AuthError, type AuthSession } from '@/globals/utils/auth';
import { studentSchema } from '@/globals/schemas/studentSchema';
import { takeRosterExclusiveLock, takeImportCommandLock } from '@/globals/utils/pgLocks';
import { parseStudentImportCsv, hasStructuralCsvErrors } from './csv';
import { classifyStudentImport, normalizeStudentImportRow } from './classify';
import {
  importRequestSchema, commitRequestSchema, IMPORT_GROUP_FIELDS,
  type ImportRequest, type ImportCommitRequest, type ParsedImportRow, type ImportReview,
} from './contract';
import { ImportError } from './errors';
import { hashImportReview, importHash } from './stateHash';
import { IMPORT_TOKEN_PURPOSE, IMPORT_TOKEN_TTL_MS, signImportToken, verifyImportToken, assertImportTokenFresh, type ImportToken } from './token';
import { hashImportCommand } from './commandHash';
import { buildImportReceiptResult } from './receiptContract';
import { projectImportReceipt } from './receiptProjection';

const READ_CHUNK = 500;
export const IMPORT_TRANSACTION_OPTIONS = { timeout:120_000, maxWait:30_000 };
const groupSelect = {id:true,slug:true,name:true,category:true} as const;
const studentSelect = {id:true,firstName:true,lastName:true,middleName:true,schoolLevel:true,yearLevel:true,createdAt:true,updatedAt:true,groups:{select:groupSelect}} as const;
function chunks<T>(values:T[]) { const result:T[][]=[]; for(let i=0;i<values.length;i+=READ_CHUNK) result.push(values.slice(i,i+READ_CHUNK)); return result; }

export function prepareImport(input: ImportRequest) {
  const sourceHash = createHash('sha256').update(input.csv,'utf8').digest('hex');
  if (sourceHash !== input.sourceHash.toLowerCase()) throw new ImportError('CSV source hash does not match this file. Replace the file.', 'SOURCE_HASH_MISMATCH');
  const parsed = parseStudentImportCsv(input.csv);
  if (hasStructuralCsvErrors(parsed)) throw new ImportError(parsed.errors.filter(e=>e.code!=='DUPLICATE_ID').slice(0,20).map(e=>e.message).join(' '), 'INVALID_CSV');
  const rows = parsed.rows.map(r=>({csvRow:r.csvRow,student:normalizeStudentImportRow(r.student)}));
  return {rows,sourceHash,normalizedInputHash:importHash({v:1,rows})};
}

/** Bounded set reads through this transaction's reader, never global Prisma. */
export async function readImportState(tx: Prisma.TransactionClient, rows: ParsedImportRow[]) {
  const fields = Object.keys(IMPORT_GROUP_FIELDS) as (keyof typeof IMPORT_GROUP_FIELDS)[];
  const slugs = [...new Set(rows.flatMap(r=>fields.map(f=>r.student[f]).filter(Boolean)))].sort();
  const ids = [...new Set(rows.map(r=>r.student.id))].sort();
  const groups: Prisma.GroupGetPayload<{select:typeof groupSelect}>[]=[];
  const students: Prisma.StudentGetPayload<{select:typeof studentSelect}>[]=[];
  for (const batch of chunks(slugs)) groups.push(...await tx.group.findMany({where:{slug:{in:batch}},select:groupSelect}));
  for (const batch of chunks(ids)) students.push(...await tx.student.findMany({where:{id:{in:batch}},select:studentSelect}));
  return {groups,students};
}

export async function guardImportActor(tx: Prisma.TransactionClient, actor: AuthSession) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const fresh = await tx.user.findUnique({where:{id:actor.id},select:{id:true,name:true,role:true,status:true,mustChangePassword:true,credentialVersion:true}});
  if (!fresh || fresh.credentialVersion!==actor.credentialVersion) throw new AuthError('Unauthorized',401,'UNAUTHORIZED');
  if (fresh.role!=='ADMIN' || fresh.status!=='ACTIVE' || fresh.mustChangePassword) throw new AuthError('Import requires an active administrator.',403,'FORBIDDEN');
  return fresh;
}

export async function previewStudentImport(db:PrismaClient, raw:unknown, actor:AuthSession) {
  const input = importRequestSchema.parse(raw);
  const prepared = prepareImport(input);
  const state = await db.$transaction(async tx=>{
    await guardImportActor(tx,actor);
    return readImportState(tx,prepared.rows);
  }, {...IMPORT_TRANSACTION_OPTIONS,isolationLevel:'RepeatableRead'});
  const review = classifyStudentImport({...state,rows:prepared.rows});
  const preparedAt=Date.now();
  const expiresAt=preparedAt+IMPORT_TOKEN_TTL_MS;
  const token:ImportToken={v:1,purpose:IMPORT_TOKEN_PURPOSE,actorId:actor.id,fileName:input.fileName,sourceHash:prepared.sourceHash,
    normalizedInputHash:prepared.normalizedInputHash,reviewHash:hashImportReview(prepared.rows,state.students,state.groups),preparedAt,expiresAt};
  return {...review,v:1 as const,previewToken:review.counts.blocked===0 ? signImportToken(token) : null,preparedAt:new Date(preparedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
}

export function verifyReviewedInput(input:ImportCommitRequest, actor:AuthSession, prepared:ReturnType<typeof prepareImport>, allowExpired=false) {
  const token = verifyImportToken(input.previewToken,actor.id,allowExpired);
  if (token.sourceHash!==prepared.sourceHash || token.normalizedInputHash!==prepared.normalizedInputHash || token.fileName!==input.fileName) throw new ImportError('The source differs from the reviewed file. Review again.','STALE_PREVIEW',409);
  return token;
}

/** Caller owns roster lock and fresh actor guard. Read Committed after waiting. */
export async function revalidateImport(tx:Prisma.TransactionClient, prepared:ReturnType<typeof prepareImport>, token:ImportToken) {
  let state=await readImportState(tx,prepared.rows);
  // Cosmetic Group renames do not use the roster advisory lock. Freeze every
  // incoming and current membership label, in the same order as group deletion.
  const groupIds=[...new Set([...state.groups.map(g=>g.id),...state.students.flatMap(s=>s.groups.map(g=>g.id))])].sort();
  for(const batch of chunks(groupIds)) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(batch)}) ORDER BY id FOR SHARE`);
  state=await readImportState(tx,prepared.rows);
  if (hashImportReview(prepared.rows,state.students,state.groups)!==token.reviewHash) throw new ImportError('Roster or Groups changed since review. Review the file again; no students were changed.','STALE_PREVIEW',409);
  const review=classifyStudentImport({...state,rows:prepared.rows});
  if (review.counts.blocked>0) throw new ImportError('This import is now blocked. Review again; no students were changed.','STALE_PREVIEW',409);
  return review;
}

export async function applyImport(tx:Prisma.TransactionClient,review:ImportReview) {
  for(const row of review.rows) {
    if(row.status==='UNCHANGED') continue;
    if(row.status!=='CREATE' && row.status!=='UPDATE') throw new ImportError('Blocked imports cannot commit.','IMPORT_BLOCKED',409);
    const student=studentSchema.parse(row.student);
    const data={firstName:student.firstName,lastName:student.lastName,middleName:student.middleName||null,schoolLevel:student.schoolLevel,yearLevel:student.yearLevel};
    const groups=row.groupIds.map(id=>({id}));
    if(row.status==='CREATE') await tx.student.create({data:{id:student.id,...data,groups:{connect:groups}}});
    else await tx.student.update({where:{id:student.id},data:{...data,groups:{set:groups}}});
  }
}

/** Distinguish a callback that could never reach COMMIT from lost commit acknowledgement. */
export async function runImportTransaction<T>(db:PrismaClient, work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  let workCompleted=false;
  try {
    return await db.$transaction(async tx=>{
      const result=await work(tx);
      workCompleted=true;
      return result;
    },IMPORT_TRANSACTION_OPTIONS);
  } catch(error) {
    if(error instanceof AuthError || error instanceof ImportError) throw error;
    if(!workCompleted || (error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2034')) {
      throw new ImportError('The import transaction was rejected and rolled back. No students were changed.','IMPORT_REJECTED',500);
    }
    throw error;
  }
}

export async function commitStudentImport(db:PrismaClient, raw:unknown, actor:AuthSession) {
  const input=commitRequestSchema.parse(raw);
  const prepared=prepareImport(input);
  // Verify purpose, signature, actor and source even on replay. Expiry only
  // prevents first execution; an immutable exact receipt remains resolvable.
  const token=verifyReviewedInput(input,actor,prepared,true);
  const requestHash=hashImportCommand(input,actor.id,prepared);
  const createdAt=new Date();
  const result=await runImportTransaction(db,async tx=>{
    const fresh=await guardImportActor(tx,actor);
    await takeImportCommandLock(tx,actor.id,input.commandId);
    const existing=await tx.studentImportBatch.findUnique({where:{actorId_commandId:{actorId:actor.id,commandId:input.commandId}}});
    if(existing) {
      if(existing.requestHash!==requestHash) throw new ImportError('This import reference was already used for a different reviewed command.','IMPORT_COMMAND_REUSED',409);
      return {receipt:projectImportReceipt(existing),replayed:true};
    }
    assertImportTokenFresh(token);
    await takeRosterExclusiveLock(tx);
    assertImportTokenFresh(token);
    const review=await revalidateImport(tx,prepared,token);
    await applyImport(tx,review);
    // Construction, insert and validation of the persisted response are inside
    // this transaction: any failure rolls back every tentative Student write.
    const receiptResult=buildImportReceiptResult(review);
    const saved=await tx.studentImportBatch.create({data:{
      commandId:input.commandId,actorId:actor.id,actorNameSnapshot:fresh.name,
      fileName:input.fileName,sourceFileHash:prepared.sourceHash,normalizedInputHash:prepared.normalizedInputHash,requestHash,
      totalRows:review.counts.total,createdCount:review.counts.create,updatedCount:review.counts.update,unchangedCount:review.counts.unchanged,
      result:receiptResult,contractVersion:1,createdAt,committedAt:new Date(),
    }});
    return {receipt:projectImportReceipt(saved),replayed:false};
  });
  return result;
}
