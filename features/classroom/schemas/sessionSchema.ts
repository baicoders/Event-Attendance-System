import { z } from 'zod';
import { commandIdSchema } from './commandId';
import { rosterQuerySchema } from './rosterSchema';
const revision=z.number().int().nonnegative();
export const startSessionSchema=z.object({
  commandId:commandIdSchema,scheduledStartAt:z.iso.datetime({offset:true}),expectedConfigRevision:revision,
  expectedRosterRevision:revision,expectedRosterFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  reason:z.string().trim().min(3).max(1000).optional(),
}).strict();
export const finalizeSessionSchema=z.object({commandId:commandIdSchema,expectedLifecycleRevision:revision,expectedSnapshotRevision:revision,reason:z.string().trim().min(3).max(1000).optional()}).strict();
export const cancelSessionSchema=z.object({commandId:commandIdSchema,expectedLifecycleRevision:revision,reason:z.string().trim().min(3).max(1000)}).strict();
export const amendPolicySchema=z.object({commandId:commandIdSchema,expectedLifecycleRevision:revision,startAt:z.iso.datetime({offset:true}),graceMinutes:z.number().int().min(0).max(180),reason:z.string().trim().min(3).max(1000)}).strict();
export const sessionRosterQuerySchema=rosterQuerySchema.extend({status:z.enum(['UNMARKED','PRESENT','LATE','ABSENT','EXCUSED']).optional(),includeExcluded:z.enum(['true','false']).default('false').transform(value=>value==='true')}).strict();
export const sessionListQuerySchema=rosterQuerySchema.omit({q:true}).extend({state:z.enum(['ACTIVE','FINALIZED','CANCELED']).optional(),date:z.iso.date().optional()}).strict();
export const policySnapshotSchema=z.object({v:z.literal(1),scheduledStartAt:z.iso.datetime(),timeZone:z.literal('Asia/Manila'),graceMinutes:z.number().int().min(0).max(180),lateAfter:z.iso.datetime()}).strict();
export const studentSnapshotSchema=z.object({
 v:z.literal(1),id:z.string(),usn:z.string().nullable(),lrn:z.string().nullable(),firstName:z.string(),lastName:z.string(),middleName:z.string().nullable(),schoolLevel:z.string().nullable(),yearLevel:z.string().nullable(),profileRevision:z.number().int().nonnegative(),
 groups:z.array(z.object({id:z.string(),name:z.string(),slug:z.string(),category:z.string()})),
});
export const memberOriginSchema=z.object({v:z.literal(1),selectedSectionIds:z.array(z.string()),individualAddition:z.boolean(),includeReason:z.string().nullable()}).passthrough();
