import { z } from 'zod';
import { studentRecordSchema } from './studentRecord';
export const studentSchema = studentRecordSchema;
// PATCH is validated again against the complete merged record inside the lock.
export const studentPatchSchema = z.object(studentRecordSchema.shape).partial().strict();
export type StudentFormValues = z.infer<typeof studentSchema>;
export type StudentPatchValues = z.infer<typeof studentPatchSchema>;
