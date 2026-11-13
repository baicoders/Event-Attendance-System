import { z } from 'zod';
import { entityId } from './rosterSchema';
import { commandIdSchema } from './commandId';
export const attendanceStudentDisplaySchema=z.object({id:z.string(),firstName:z.string(),middleName:z.string().nullable(),lastName:z.string(),usn:z.string().nullable(),lrn:z.string().nullable()});
export const finalAttendanceStatus=z.enum(['PRESENT','LATE','ABSENT','EXCUSED']);
const revision=z.number().int().nonnegative();
const note=z.string().trim().max(1000).nullable().optional();
const reason=z.string().trim().min(3).max(1000);
const rawCode=z.string().trim().min(1).max(128).refine(value=>!value.includes('\0'),'This QR code contains unsupported characters.');
export const classroomScanSchema=z.object({commandId:commandIdSchema,sessionId:entityId,code:rawCode,reason:reason.optional()}).strict();
export const manualAttendanceSchema=z.object({
 commandId:commandIdSchema,sessionId:entityId,studentId:entityId,expectedRevision:revision,
 status:finalAttendanceStatus,excuseNote:note,reason:reason.optional(),
}).strict().refine(value=>value.status==='EXCUSED'||!value.excuseNote,'Excuse notes belong only to Excused attendance.');
export const rosterAdjustmentSchema=z.object({
 commandId:commandIdSchema,sessionId:entityId,studentId:entityId,
 action:z.enum(['INCLUDE','EXCLUDE']),scope:z.enum(['SESSION','CLASS_ONLY','CLASS_AND_SESSION']),
 expectedSnapshotRevision:revision,expectedRosterRevision:revision.optional(),expectedAttendanceRevision:revision.optional(),
 reason,recordScan:z.boolean().default(false),code:rawCode.optional(),
 confirmReplaceExclusion:z.boolean().default(false),finalStatus:finalAttendanceStatus.optional(),excuseNote:note,
}).strict().superRefine((value,ctx)=>{
 const fail=(message:string,path:string)=>ctx.addIssue({code:'custom',message,path:[path]});
 if(value.scope!=='SESSION'&&value.expectedRosterRevision===undefined)fail('Include the current class roster revision.','expectedRosterRevision');
 if(value.recordScan&&!value.code)fail('Keep the original QR code when recording the scan.','code');
 if(value.code&&!value.recordScan)fail('A QR code is only needed when recording a scan.','code');
 if(value.recordScan&&value.finalStatus)fail('Choose scanning or an explicit historical outcome.','finalStatus');
 if((value.action==='EXCLUDE'||value.scope==='CLASS_ONLY')&&(value.recordScan||value.finalStatus||value.excuseNote!==undefined))fail('This choice changes enrollment only.','scope');
 if(value.excuseNote&&value.finalStatus!=='EXCUSED')fail('Excuse notes belong only to an explicit Excused outcome.','excuseNote');
});
