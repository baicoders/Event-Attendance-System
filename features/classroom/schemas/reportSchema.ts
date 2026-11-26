import { z } from 'zod';
import { entityId } from './rosterSchema';
export const reportScopeFields={termId:entityId.optional(),classId:entityId.optional(),gradingPeriodId:z.uuid().optional(),sessionId:entityId.optional(),studentId:entityId.optional(),from:z.iso.date().optional(),to:z.iso.date().optional()};
export const reportLinkFields={...reportScopeFields,view:z.literal('class').optional()};
export const reportQuerySchema=z.object({...reportLinkFields,meetingPage:z.coerce.number().int().min(1).max(100).default(1),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100),expectedReportVersion:z.string().regex(/^[a-f0-9]{64}$/).optional(),format:z.enum(['SUMMARY','DETAIL','XLSX']).default('SUMMARY')}).strict().superRefine((value,ctx)=>{
 if(!value.sessionId&&!value.termId)ctx.addIssue({code:'custom',message:'Choose an academic term or a single attendance session.',path:['termId']});
 if(value.view==='class'&&(!value.classId||!value.termId||value.sessionId||value.studentId))ctx.addIssue({code:'custom',message:'Choose a class and term for the register.',path:['classId']});
 if(value.format==='XLSX'&&value.view!=='class')ctx.addIssue({code:'custom',message:'Choose a Class report for Excel.',path:['view']});
 if(value.gradingPeriodId&&!value.termId)ctx.addIssue({code:'custom',message:'Choose the grading period’s academic term.',path:['termId']});
 if(value.gradingPeriodId&&(value.from||value.to))ctx.addIssue({code:'custom',message:'Choose a grading period or custom dates.',path:['gradingPeriodId']});
 if(value.from&&value.to&&value.from>value.to)ctx.addIssue({code:'custom',message:'The end date must follow the start date.',path:['to']});
});
