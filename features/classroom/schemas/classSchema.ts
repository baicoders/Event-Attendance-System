import { z } from 'zod';
import { commandIdSchema } from './commandId';
import { entityId,rosterFields } from './rosterSchema';
const schoolDate=z.iso.date();
const clockTime=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/,'Use a valid 24-hour school time.');
export const scheduleSchema=z.object({v:z.literal(1),days:z.array(z.number().int().min(1).max(7)).min(1).max(7).transform(days=>[...new Set(days)].sort()),startTime:clockTime,endTime:clockTime.optional(),room:z.string().trim().max(100).optional()}).strict().refine(value=>!value.endTime||value.endTime>value.startTime,'End time must be after start time.');
const reason=z.string().trim().min(3).max(1000);
export const termSchema=z.object({commandId:commandIdSchema,name:z.string().trim().min(1).max(100),startDate:schoolDate,endDate:schoolDate}).strict().refine(value=>value.endDate>=value.startDate,'Term end date must follow its start date.');
export const subjectSchema=z.object({commandId:commandIdSchema,code:z.string().trim().max(40).nullable().optional(),title:z.string().trim().min(1).max(160)}).strict();
export const classSchema=z.object({commandId:commandIdSchema,termId:entityId,subjectId:entityId,displayName:z.string().trim().min(1).max(160),schedule:scheduleSchema.nullable().optional(),graceMinutes:z.number().int().min(0).max(180).default(15),primaryTeacherId:entityId.optional(),onboardingExpectedRevision:z.number().int().nonnegative().optional(),...rosterFields,reason:reason.optional()}).strict();
export const classPatchSchema=z.object({commandId:commandIdSchema,expectedConfigRevision:z.number().int().nonnegative(),displayName:z.string().trim().min(1).max(160).optional(),schedule:scheduleSchema.nullable().optional(),graceMinutes:z.number().int().min(0).max(180).optional(),archived:z.boolean().optional(),reason:reason.optional()}).strict().refine(value=>['displayName','schedule','graceMinutes','archived'].some(field=>Object.hasOwn(value,field)),'Choose a setting to change.');
export const ownerSchema=z.object({commandId:commandIdSchema,expectedConfigRevision:z.number().int().nonnegative(),teacherId:entityId,reason}).strict();
export const catalogQuerySchema=z.object({q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100),includeArchived:z.enum(['true','false']).default('false').transform(value=>value==='true')}).strict();
export const classQuerySchema=catalogQuerySchema.extend({termId:entityId.optional(),teacherId:entityId.optional(),attendanceState:z.enum(['ACTIVE','READY']).optional()}).strict();
export const gradingPeriodFields = z.object({
  name: z.string().trim().min(1).max(100),
  startDate: schoolDate,
  endDate: schoolDate,
});
export const gradingPeriodSchema = gradingPeriodFields.extend({ id: z.uuid() }).strict();
export const gradingPeriodDraftSchema = gradingPeriodFields.extend({ id: z.uuid().optional() }).strict();
export const termPatchSchema=z.object({commandId:commandIdSchema,expectedRevision:z.number().int().nonnegative(),gradingPeriods:z.array(gradingPeriodDraftSchema).max(100).optional(),name:z.string().trim().min(1).max(100).optional(),startDate:schoolDate.optional(),endDate:schoolDate.optional(),archived:z.boolean().optional(),reason}).strict().refine(value=>['name','startDate','endDate','archived','gradingPeriods'].some(field=>Object.hasOwn(value,field)),'Choose a catalog field to change.');
export const subjectPatchSchema=z.object({commandId:commandIdSchema,expectedRevision:z.number().int().nonnegative(),code:z.string().trim().max(40).nullable().optional(),title:z.string().trim().min(1).max(160).optional(),archived:z.boolean().optional(),reason}).strict().refine(value=>['code','title','archived'].some(field=>Object.hasOwn(value,field)),'Choose a catalog field to change.');
