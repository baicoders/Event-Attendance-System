import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@/globals/utils/api';
import { createAttendanceCoordinator,type CommandDescriptor } from './scanCoordinator';
const scope={userId:'teacher',kind:'SESSION' as const,id:'session'};
const payload={sessionId:'session',code:'000123'};
const result={sessionId:'session',studentId:'student',outcome:'RECORDED',changed:true,attendance:{sessionId:'session',studentId:'student',status:'PRESENT',revision:1}};
function harness(send:(entry:CommandDescriptor,signal:AbortSignal)=>Promise<unknown>){const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};let confirmed=0;const make=()=>createAttendanceCoordinator({scope,storage,send,lookup:async()=>{throw new ApiError('Not found',404,'COMMAND_NOT_FOUND');},onConfirmed:()=>{confirmed++;}});return {make,values,get confirmed(){return confirmed;}};}
test('only acknowledged commands confirm; reload preserves UUID without background writes',async()=>{let calls=0;let first='';const h=harness(async entry=>{calls++;first ||= entry.commandId;if(calls===1)throw new Error('lost response');assert.equal(entry.commandId,first);return result;});let c=h.make();await c.submit('SCAN',payload);assert.equal(h.confirmed,0);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');c.dispose();c=h.make();assert.equal(calls,1);assert.equal(c.snapshot()[0].commandId,first);await c.retry(first);assert.equal(h.confirmed,1);assert.equal(c.snapshot().length,0);});
test('camera decoder suppresses repeats while explicit retry retains command; mode switch does not dispose',async()=>{const h=harness(async()=>{throw new Error('offline');});const c=h.make();await c.scan('000123');await c.scan('000123');assert.equal(c.snapshot().length,1);assert.equal(c.acceptScan('000123'),false);assert.equal(c.acceptScan('different'),true);c.dispose();});
test('dispose aborts writes and ignores stale callbacks while retaining an uncertain descriptor',async()=>{let resolve!:(value:unknown)=>void;let signal!:AbortSignal;const h=harness(async(_,s)=>{signal=s;return new Promise(r=>{resolve=r;});});const c=h.make();const pending=c.submit('SCAN',payload);c.dispose();assert.equal(signal.aborted,true);resolve(result);await pending;assert.equal(h.confirmed,0);assert.equal(h.make().snapshot()[0].state,'UNCONFIRMED');});
test('malformed acknowledgments and retry rate limits cannot clear an uncertain save',async()=>{let calls=0;const h=harness(async()=>{calls++;if(calls===1)return {};throw new ApiError('Slow down',429);});const c=h.make();await c.submit('SCAN',payload);const id=c.snapshot()[0].commandId;await c.retry(id);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');assert.equal(h.confirmed,0);});
test('serialized domain rejection settles a previous unknown save, preauthorization rejection does not',async()=>{let calls=0;const h=harness(async()=>{if(++calls===1)throw new Error('lost');throw new ApiError('Closed',409,'SESSION_FINALIZED',{commandSettled:true});});const c=h.make();await c.submit('SCAN',payload);await c.retry(c.snapshot()[0].commandId);assert.equal(c.snapshot().length,0);assert.equal(h.confirmed,0);});
test('wrong-session acknowledgments never confirm; receipts must match operation and resource',async()=>{const h=harness(async()=>({...result,sessionId:'someone-else'}));const c=h.make();await c.submit('SCAN',payload);assert.equal(h.confirmed,0);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');});
test('storage failures fail before sending',async()=>{let calls=0;const c=createAttendanceCoordinator({scope,storage:{getItem:()=>null,setItem:()=>{throw new Error('storage blocked');},removeItem:()=>{}},send:async()=>{calls++;return result;},lookup:async()=>null});await assert.rejects(c.submit('SCAN',payload),/recover/i);assert.equal(calls,0);});
test('actor-scoped storage never restores another teacher’s pending commands',async()=>{const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};const options={storage,send:async()=>{throw new Error('lost');},lookup:async()=>null};const original=createAttendanceCoordinator({...options,scope});await original.submit('SCAN',payload);original.dispose();assert.equal(createAttendanceCoordinator({...options,scope:{...scope,userId:'other'}}).snapshot().length,0);assert.equal(createAttendanceCoordinator({...options,scope:{...scope,id:'other-session'}}).snapshot().length,0);});
test('receipt lookup confirms without resubmitting a rate-limited scanner',async()=>{let calls=0,confirmed=0;const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};const c=createAttendanceCoordinator({scope,storage,send:async()=>{calls++;throw new Error('ack lost');},lookup:async commandId=>({commandId,operation:'RECORD_CLASSROOM_SCAN',resourceId:scope.id,result}),onConfirmed:()=>{confirmed++;}});await c.submit('SCAN',payload);await c.retry(c.snapshot()[0].commandId);assert.equal(calls,1);assert.equal(confirmed,1);});
test('an impossible Unmarked scan acknowledgment remains uncertain',async()=>{const h=harness(async()=>({...result,attendance:{...result.attendance,status:'UNMARKED'}}));const c=h.make();await c.submit('SCAN',payload);assert.equal(h.confirmed,0);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');});


test('student display acknowledgments reject mismatched or malformed identities while legacy receipts remain valid',async()=>{
 const student={id:'student',firstName:'Ada',middleName:null,lastName:'Lovelace',usn:'00000012345',lrn:'000000123456'};
 for(const value of [{...student,id:'someone-else'},{...student,usn:12345},{...student,middleName:undefined}]){
  const h=harness(async()=>({...result,student:value}));const c=h.make();await c.submit('SCAN',payload);assert.equal(h.confirmed,0);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');
 }
 for(const value of [result,{...result,student}]){
  const h=harness(async()=>value);const c=h.make();await c.submit('SCAN',payload);assert.equal(h.confirmed,1);assert.equal(c.snapshot().length,0);
 }
});
test('enroll-and-scan cannot confirm a display identity belonging to another attendance student',async()=>{
 const h=harness(async()=>({sessionId:'session',studentId:'student',scope:'SESSION',action:'INCLUDE',snapshotRevision:1,rosterRevision:0,changed:true,attendance:result.attendance,student:{id:'other',firstName:'Other',middleName:null,lastName:'Student',usn:null,lrn:null}}));
 const c=h.make();await c.submit('ADJUSTMENT',{sessionId:'session',studentId:'student',scope:'SESSION',action:'INCLUDE',expectedSnapshotRevision:0,reason:'Include this meeting',recordScan:true,code:'000123'});assert.equal(h.confirmed,0);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');
});

test('recovery settles restored operations in creation order before accepting a new decision',async()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
 const entry=(commandId:string,createdAt:number):CommandDescriptor=>({commandId,createdAt,kind:'MANUAL',state:'UNCONFIRMED',payload:{commandId,sessionId:'session',studentId:'student',status:'PRESENT',expectedRevision:0}});
 storage.setItem('classroom:commands:v1:teacher:SESSION:session',JSON.stringify([entry(second,2),entry(first,1)]));
 const order:string[]=[];const c=createAttendanceCoordinator({scope,storage,send:async()=>result,lookup:async commandId=>{order.push(commandId);return {commandId,operation:'SET_CLASSROOM_ATTENDANCE',resourceId:'session',result};}});
 await assert.rejects(c.submit('MANUAL',{sessionId:'session',studentId:'student',status:'ABSENT',expectedRevision:0}),/recover/i);
 await c.recover();assert.deepEqual(order,[first,second]);assert.equal(c.snapshot().length,0);
});
test('an unresolved recovered operation keeps later operations untouched',async()=>{
 const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
 const entries=[first,second].map((commandId,index)=>({commandId,createdAt:index,kind:'SCAN',state:'UNCONFIRMED',payload:{commandId,sessionId:'session',code:'000'+index}}));let saved=JSON.stringify(entries);const lookups:string[]=[];
 const c=createAttendanceCoordinator({scope,storage:{getItem:()=>saved,setItem:(_,value)=>{saved=value;},removeItem:()=>{}},send:async()=>result,lookup:async commandId=>{lookups.push(commandId);throw new Error('Network unavailable');}});
 await c.recover();assert.deepEqual(lookups,[first]);assert.equal(c.snapshot().length,2);
});

test('storage loss during restored recovery keeps the original key retryable and sends nothing',async()=>{
 const commandId='00000000-0000-4000-8000-000000000001';let blocked=true;let sends=0;let problems=0;
 let saved=JSON.stringify([{commandId,createdAt:0,kind:'SCAN',state:'UNCONFIRMED',payload:{commandId,sessionId:'session',code:'000123'}}]);
 const c=createAttendanceCoordinator({scope,storage:{getItem:()=>saved,setItem:(_,value)=>{if(blocked)throw new Error('Storage blocked');saved=value;},removeItem:()=>{}},send:async()=>{sends++;return result;},lookup:async()=>({commandId,operation:'RECORD_CLASSROOM_SCAN',resourceId:'session',result}),onProblem:()=>{problems++;}});
 await c.recover();assert.equal(sends,0);assert.equal(problems,1);assert.equal(c.snapshot()[0].state,'UNCONFIRMED');assert.equal(c.snapshot()[0].commandId,commandId);
 blocked=false;await c.retry(commandId);assert.equal(c.snapshot().length,0);assert.equal(sends,0);
});
