import { z } from 'zod';
import { entityId } from './rosterSchema';
export const reportScopeFields={termId:entityId.optional(),classId:entityId.optional(),sessionId:entityId.optional(),studentId:entityId.optional(),from:z.iso.date().optional(),to:z.iso.date().optional()};
export const reportQuerySchema=z.object({...reportScopeFields,page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100),expectedReportVersion:z.string().regex(/^[a-f0-9]{64}$/).optional(),format:z.enum(['SUMMARY','DETAIL']).default('SUMMARY')}).strict().superRefine((value,ctx)=>{
 if(!value.sessionId&&!value.termId)ctx.addIssue({code:'custom',message:'Choose an academic term or a single attendance session.',path:['termId']});
 if(value.from&&value.to&&value.from>value.to)ctx.addIssue({code:'custom',message:'The end date must follow the start date.',path:['to']});
});
