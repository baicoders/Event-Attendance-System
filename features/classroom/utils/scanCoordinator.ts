import { z } from 'zod';
import { ApiError } from '@/globals/utils/api';
import { classroomScanSchema,manualAttendanceSchema,rosterAdjustmentSchema } from '../schemas/attendanceSchema';
import { startSessionSchema,finalizeSessionSchema,cancelSessionSchema,amendPolicySchema } from '../schemas/sessionSchema';
import { settledCommandFailure } from './commandFailure';
export type AttendanceScope={userId:string;kind:'SESSION'|'CLASS';id:string};
export type CommandKind='SCAN'|'MANUAL'|'ADJUSTMENT'|'FINALIZE'|'CANCEL'|'POLICY'|'START';
export type CommandDescriptor={commandId:string;kind:CommandKind;payload:Record<string,unknown>;state:'SAVING'|'UNCONFIRMED';createdAt:number;message?:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const schemas={SCAN:classroomScanSchema,MANUAL:manualAttendanceSchema,ADJUSTMENT:rosterAdjustmentSchema,FINALIZE:finalizeSessionSchema,CANCEL:cancelSessionSchema,POLICY:amendPolicySchema,START:startSessionSchema};
export const commandOperations:Record<CommandKind,string>={SCAN:'RECORD_CLASSROOM_SCAN',MANUAL:'SET_CLASSROOM_ATTENDANCE',ADJUSTMENT:'ADJUST_SESSION_ROSTER',FINALIZE:'FINALIZE_CLASSROOM_SESSION',CANCEL:'CANCEL_CLASSROOM_SESSION',POLICY:'AMEND_CLASSROOM_POLICY',START:'START_CLASSROOM_SESSION'};
export function attendanceCommandRequest(scope:AttendanceScope,entry:CommandDescriptor){
 const root='/api/classroom/';const suffix={SCAN:'scans',MANUAL:'attendance/'+encodeURIComponent(String(entry.payload.studentId)),ADJUSTMENT:'roster-adjustments',FINALIZE:'finalize',CANCEL:'cancel',POLICY:'policy-amendments',START:''}[entry.kind];
 return {path:entry.kind==='START'?root+'classes/'+encodeURIComponent(scope.id)+'/sessions':root+'sessions/'+encodeURIComponent(scope.id)+'/'+suffix,method:entry.kind==='MANUAL'?'PUT':'POST',body:JSON.stringify(entry.payload)};
}
const attendanceAck=z.object({sessionId:z.string(),studentId:z.string(),status:z.enum(['UNMARKED','PRESENT','LATE','ABSENT','EXCUSED']),revision:z.number().int().nonnegative()}).passthrough();
const sessionAck=z.object({id:z.string(),classId:z.string(),state:z.enum(['ACTIVE','FINALIZED','CANCELED']),lifecycleRevision:z.number().int().nonnegative(),snapshotRevision:z.number().int().nonnegative(),counts:z.object({UNMARKED:z.number(),PRESENT:z.number(),LATE:z.number(),ABSENT:z.number(),EXCUSED:z.number()})}).passthrough();
function acknowledged(scope:AttendanceScope,entry:CommandDescriptor,value:unknown){
 if(entry.kind==='SCAN'||entry.kind==='MANUAL'){
  const parsed=z.object({sessionId:z.string(),studentId:z.string(),outcome:z.enum(['RECORDED','ALREADY_RECORDED','ALREADY_MARKED','UNCHANGED']),changed:z.boolean(),attendance:attendanceAck}).passthrough().parse(value);
  if(parsed.attendance.status==='UNMARKED'||parsed.sessionId!==scope.id||parsed.attendance.sessionId!==scope.id||parsed.studentId!==parsed.attendance.studentId||(entry.kind==='MANUAL'&&parsed.studentId!==entry.payload.studentId))throw new Error('Wrong attendance acknowledgment');
 }else if(entry.kind==='ADJUSTMENT'){
  const parsed=z.object({sessionId:z.string(),studentId:z.string(),snapshotRevision:z.number().int(),rosterRevision:z.number().int(),scope:z.string(),action:z.string(),changed:z.boolean(),attendance:attendanceAck.nullable()}).passthrough().parse(value);
  if(parsed.sessionId!==scope.id||parsed.studentId!==entry.payload.studentId||parsed.scope!==entry.payload.scope||parsed.action!==entry.payload.action||(parsed.attendance&&(parsed.attendance.sessionId!==scope.id||parsed.attendance.studentId!==parsed.studentId)))throw new Error('Wrong enrollment acknowledgment');
 }else{const parsed=sessionAck.parse(value);if(entry.kind==='START'?parsed.classId!==scope.id:parsed.id!==scope.id)throw new Error('Wrong session acknowledgment');}
 return value;
}
/** Bounded, explicit recovery of already-sent commands. This is not an offline queue. */
export function createAttendanceCoordinator(options:{scope:AttendanceScope;storage:Store;send:(entry:CommandDescriptor,signal:AbortSignal)=>Promise<unknown>;lookup:(id:string,signal:AbortSignal)=>Promise<unknown>;onChange?:()=>void;onConfirmed?:(entry:CommandDescriptor,result:unknown)=>void;onProblem?:(entry:CommandDescriptor,error:unknown)=>void}){
 const {scope,storage}=options;const key='classroom:commands:v1:'+encodeURIComponent(scope.userId)+':'+scope.kind+':'+encodeURIComponent(scope.id);
 const entries=new Map<string,CommandDescriptor>();const controllers=new Map<string,AbortController>();let disposed=false;const seen=new Map<string,number>();
 function validate(entry:CommandDescriptor){if((entry.kind==='START')!==(scope.kind==='CLASS'))throw new Error('Invalid command scope');const payload=schemas[entry.kind].parse(entry.payload);if(payload.commandId!==entry.commandId||('sessionId' in payload&&payload.sessionId!==scope.id))throw new Error('Invalid command context');return entry;}
 const saved=storage.getItem(key);
 if(saved){const raw=JSON.parse(saved);if(!Array.isArray(raw)||raw.length>8||saved.length>100000)throw new Error('Unable to read pending attendance recovery. Keep this page open and contact support.');for(const value of raw){const entry=validate(value);entries.set(entry.commandId,{...entry,state:'UNCONFIRMED',message:'A previous save needs confirmation. Check the same save.'});}}
 function persist(){try{storage.setItem(key,JSON.stringify([...entries.values()]));}catch{throw new Error('Unable to prepare recoverable attendance. Enable browser storage before saving.');}}
 function changed(){if(!disposed)options.onChange?.();}
 async function perform(entry:CommandDescriptor,recover:boolean){
  if(disposed||controllers.has(entry.commandId))return;
  const controller=new AbortController();controllers.set(entry.commandId,controller);entry.state='SAVING';entry.message=undefined;persist();changed();
  try{
   let value:unknown;
   if(recover){try{const receipt=z.object({commandId:z.string(),operation:z.string(),resourceId:z.string(),result:z.unknown()}).parse(await options.lookup(entry.commandId,controller.signal));if(receipt.commandId!==entry.commandId||receipt.operation!==commandOperations[entry.kind]||receipt.resourceId!==scope.id)throw new Error('Wrong command receipt');value=acknowledged(scope,entry,receipt.result);}catch(error){if(!(error instanceof ApiError&&error.hasValidResponse&&error.status===404&&error.code==='COMMAND_NOT_FOUND'))throw error;}}
   if(value===undefined)value=acknowledged(scope,entry,await options.send(entry,controller.signal));
   if(disposed)return;entries.delete(entry.commandId);persist();options.onConfirmed?.(entry,value);
  }catch(error){
   if(disposed)return;
   if(settledCommandFailure(error,recover)){entries.delete(entry.commandId);persist();options.onProblem?.(entry,error);}else{entry.state='UNCONFIRMED';entry.message='Save not confirmed. Check or retry this same save.';persist();options.onProblem?.(entry,error);}
  }finally{controllers.delete(entry.commandId);changed();}
 }
 return {
  snapshot:()=>[...entries.values()].map(entry=>({...entry})),
  acceptScan(code:string){const now=Date.now();if([...entries.values()].some(e=>e.kind==='SCAN'&&e.payload.code===code)||now-(seen.get(code)??0)<1800)return false;seen.set(code,now);if(seen.size>100)seen.delete(seen.keys().next().value!);return true;},
  async scan(code:string,reason?:string){if(!this.acceptScan(code))return;return this.submit('SCAN',{sessionId:scope.id,code,...(reason?{reason}:{})});},
  async submit(kind:CommandKind,payload:Record<string,unknown>){
   if(disposed)return;if(entries.size>=8||controllers.size>=3)throw new Error('Finish or recover the pending saves before recording more attendance.');
   const commandId=crypto.randomUUID();const body=schemas[kind].parse({...payload,commandId});const entry=validate({commandId,kind,payload:body,state:'SAVING',createdAt:Date.now()});entries.set(commandId,entry);try{persist();}catch(error){entries.delete(commandId);throw error;}return perform(entry,false);
  },
  async retry(id:string){const entry=entries.get(id);if(entry&&!disposed&&controllers.size<3)return perform(entry,true);},
  dispose(){disposed=true;for(const controller of controllers.values())controller.abort();for(const entry of entries.values())entry.state='UNCONFIRMED';if(entries.size)persist();},
 };
}
export type AttendanceCoordinator=ReturnType<typeof createAttendanceCoordinator>;
