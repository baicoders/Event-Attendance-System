import { z } from 'zod';
import { commandIdSchema } from './commandId';
export const entityId=z.string().trim().min(1).max(128);
export const rosterFields={
 sectionIds:z.array(entityId).max(100).transform(values=>[...new Set(values)].sort()),
 exceptions:z.array(z.object({studentId:entityId,kind:z.enum(['INCLUDE','EXCLUDE']),reason:z.string().trim().min(3).max(1000)}).strict()).max(500).default([]).superRefine((rows,ctx)=>{if(new Set(rows.map(row=>row.studentId)).size!==rows.length)ctx.addIssue({code:'custom',message:'A student can have only one saved roster exception.'});}),
};
export const rosterSchema=z.object({commandId:commandIdSchema,expectedRosterRevision:z.number().int().nonnegative(),...rosterFields,reason:z.string().trim().min(3).max(1000).optional()}).strict();
export const rosterQuerySchema=z.object({q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100)}).strict();
