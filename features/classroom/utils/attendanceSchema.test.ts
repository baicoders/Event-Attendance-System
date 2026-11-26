import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { classroomRouteBody } from './routeBody';
import { classroomScanSchema,rosterAdjustmentSchema } from '../schemas/attendanceSchema';
test('a body cannot silently identify a different session or student than its route',()=>{
 assert.throws(()=>classroomRouteBody({studentId:'other',commandId:randomUUID()},{studentId:'selected',sessionId:'meeting'}),{code:'ROUTE_ID_MISMATCH'});
 assert.deepEqual(classroomRouteBody({studentId:'selected',reason:'Correction'},{studentId:'selected'}),{studentId:'selected',reason:'Correction'});
});
test('QR payloads preserve leading zeroes and reject database-invalid NUL characters before lookup',()=>{
 const input={commandId:randomUUID(),sessionId:'meeting',code:'00000123456'};assert.equal(classroomScanSchema.parse(input).code,'00000123456');
 assert.equal(classroomScanSchema.safeParse({...input,code:'bad\0code'}).success,false);
});
test('enrollment choices cannot accidentally record attendance for class-only or excluded students',()=>{
 const input={commandId:randomUUID(),sessionId:'meeting',studentId:'student',scope:'CLASS_ONLY',action:'INCLUDE',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Enroll for future meetings'};
 assert.equal(rosterAdjustmentSchema.safeParse({...input,recordScan:true,code:'student'}).success,false);
 assert.equal(rosterAdjustmentSchema.safeParse({...input,scope:'SESSION',action:'EXCLUDE',finalStatus:'PRESENT'}).success,false);
 assert.equal(rosterAdjustmentSchema.safeParse({...input,scope:'SESSION',recordScan:true}).success,false);
});
