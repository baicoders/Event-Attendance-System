import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AuthSession } from '@/globals/utils/auth';
import { guardImportActor, IMPORT_TRANSACTION_OPTIONS } from './server';
import { ImportError } from './errors';
import { receiptMetadataSelect, projectReceiptMetadata, projectImportReceipt, type MetadataRow } from './receiptProjection';

const cursorSchema=z.object({v:z.literal(1),committedAt:z.iso.datetime(),id:z.string().min(1).max(100)}).strict();
const querySchema=z.object({before:z.string().min(1).max(1024).optional(),limit:z.coerce.number().int().min(1).max(20).default(20)}).strict();
function decodeCursor(cursor:string) {
  try {
    if(!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('encoding');
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));
  } catch { throw new ImportError('Invalid import-history cursor.','INVALID_CURSOR'); }
}
function encodeCursor(row:MetadataRow) {
  return Buffer.from(JSON.stringify({v:1,committedAt:row.committedAt.toISOString(),id:row.id})).toString('base64url');
}

export async function listImportReceipts(db:PrismaClient, raw:unknown, actor:AuthSession) {
  const query=querySchema.parse(raw);
  const before=query.before ? decodeCursor(query.before) : null;
  return db.$transaction(async tx=>{
    await guardImportActor(tx,actor);
    const rows=await tx.studentImportBatch.findMany({
      where:before ? {OR:[{committedAt:{lt:new Date(before.committedAt)}},{committedAt:new Date(before.committedAt),id:{lt:before.id}}]} : undefined,
      orderBy:[{committedAt:'desc'},{id:'desc'}],take:query.limit+1,select:receiptMetadataSelect,
    });
    const page=rows.slice(0,query.limit);
    return {items:page.map(projectReceiptMetadata),nextCursor:rows.length>query.limit ? encodeCursor(page[page.length-1]) : null};
  },IMPORT_TRANSACTION_OPTIONS);
}

/** Normal history uses server receipt ID; command resolution is actor-scoped. */
export async function getImportReceipt(db:PrismaClient, id:string, actor:AuthSession, byCommand=false) {
  const identity=byCommand ? z.uuid().transform(value=>value.toLowerCase()).parse(id) : z.string().min(1).max(100).parse(id);
  return db.$transaction(async tx=>{
    await guardImportActor(tx,actor);
    const row=await tx.studentImportBatch.findUnique({where:byCommand ? {actorId_commandId:{actorId:actor.id,commandId:identity}} : {id:identity}});
    if(!row) throw new ImportError('No receipt is visible for this reference yet. An in-flight import may still commit.','IMPORT_RECEIPT_NOT_FOUND',404);
    return projectImportReceipt(row);
  },IMPORT_TRANSACTION_OPTIONS);
}
