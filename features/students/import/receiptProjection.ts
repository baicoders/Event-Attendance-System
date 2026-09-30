import 'server-only';
import { Prisma } from '@prisma/client';
import { receiptMetadataSchema, validateImportReceipt } from './receiptContract';

// Explicit metadata projection: history never selects result JSONB.
export const receiptMetadataSelect = {
  id:true,commandId:true,actorId:true,actorNameSnapshot:true,fileName:true,
  sourceFileHash:true,normalizedInputHash:true,requestHash:true,totalRows:true,
  createdCount:true,updatedCount:true,unchangedCount:true,contractVersion:true,
  createdAt:true,committedAt:true,
} as const;
export type MetadataRow = Prisma.StudentImportBatchGetPayload<{select:typeof receiptMetadataSelect}>;
export function projectReceiptMetadata(row:MetadataRow) {
  return receiptMetadataSchema.parse({
    v:row.contractVersion,id:row.id,commandId:row.commandId,actorId:row.actorId,
    actorNameSnapshot:row.actorNameSnapshot,fileName:row.fileName,sourceFileHash:row.sourceFileHash,
    normalizedInputHash:row.normalizedInputHash,requestHash:row.requestHash,
    counts:{total:row.totalRows,create:row.createdCount,update:row.updatedCount,unchanged:row.unchangedCount,blocked:0},
    createdAt:row.createdAt.toISOString(),committedAt:row.committedAt.toISOString(),
  });
}
export function projectImportReceipt(row:Prisma.StudentImportBatchGetPayload<object>) {
  return validateImportReceipt({...projectReceiptMetadata(row),result:row.result});
}
