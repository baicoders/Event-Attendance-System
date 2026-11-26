import assert from 'node:assert/strict';import { test } from 'node:test';
import { parseAttendanceView,attendanceViewParams } from './attendanceView';
test('session filters/page/mode survive a URL round trip without carrying authorization or QR commands',()=>{const view={q:'00000123 / Ñ',status:'UNMARKED' as const,page:3,includeExcluded:true,mode:'SCAN' as const,manualView:'ROSTER' as const};const params=attendanceViewParams(view);assert.deepEqual(parseAttendanceView(params),view);assert.equal(params.has('code'),false);const untrusted=new URLSearchParams('role=ADMIN&workspace=EVENTS&commandId=one&code=raw&status=ADMIN&page=-5&mode=anything');assert.deepEqual(parseAttendanceView(untrusted),{q:'',status:'',page:1,includeExcluded:false,mode:'MANUAL',manualView:'ROSTER'});});
test('invalid browser preferences normalize safely; default view has a clean URL',()=>{assert.equal(attendanceViewParams(parseAttendanceView(new URLSearchParams())).toString(),'');const view=parseAttendanceView(new URLSearchParams({q:'  '+ 'x'.repeat(110)+'\0 ',page:'99999999',includeExcluded:'true'}));assert.equal(view.q.length,100);assert.equal(view.page,1);assert.equal(view.q.includes('\0'),false);});

test('plain session URLs focus; explicit legacy roster selections retain roster review',()=>{
 assert.equal(parseAttendanceView(new URLSearchParams()).manualView,'FOCUS');
 for(const query of ['status=','status=UNMARKED','page=1','includeExcluded=false','includeExcluded=true'])assert.equal(parseAttendanceView(new URLSearchParams(query)).manualView,'ROSTER');
 assert.equal(parseAttendanceView(new URLSearchParams('q=Name')).manualView,'FOCUS');
 assert.equal(parseAttendanceView(new URLSearchParams('manualView=FOCUS&status=ABSENT&page=3')).manualView,'FOCUS');
 assert.equal(parseAttendanceView(new URLSearchParams('manualView=ROSTER')).manualView,'ROSTER');
});
test('switching manual views round trips roster preferences including a focus override',()=>{
 const view={q:'000001',status:'ABSENT' as const,page:3,includeExcluded:true,mode:'MANUAL' as const,manualView:'FOCUS' as const};assert.deepEqual(parseAttendanceView(attendanceViewParams(view)),view);
});
