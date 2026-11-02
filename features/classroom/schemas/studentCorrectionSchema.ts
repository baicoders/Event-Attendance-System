import { z } from 'zod';
import { studentPatchSchema } from '@/globals/schemas/studentSchema';
import { commandIdSchema } from './commandId';
export const identifierDispositionSchema=z.enum(['KEEP_ALIAS_CONFIRMED','REPRINT_REQUIRED']);
export const studentCorrectionSchema=z.object({
 commandId:commandIdSchema,expectedVersion:z.string().regex(/^[a-f0-9]{64}$/),
 student:studentPatchSchema.omit({id:true,house:true}).strict().refine(value=>Object.keys(value).length>0,'Choose a field to correct.'),
 reason:z.string().trim().min(3).max(1000),identifierDisposition:identifierDispositionSchema.optional(),
}).strict();
export const studentVerificationSchema=z.object({commandId:commandIdSchema,expectedVersion:z.string().regex(/^[a-f0-9]{64}$/),state:z.enum(['VERIFIED','NEEDS_CORRECTION']),note:z.string().trim().max(1000).optional()}).strict();
