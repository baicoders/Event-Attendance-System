import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketForStudent } from './reportGroups';
import { buildAttendanceProgress } from './attendanceProgress';
import { isStudentInEvent } from './buildEventStudentFilter';
test('missing year is an honest unassigned reporting bucket', () => {
  assert.equal(bucketForStudent({yearLevel:null,groups:[]},'YEAR').key,'none');
  const result=buildAttendanceProgress({students:[{id:'fixture',firstName:'Test',lastName:'Student',middleName:null,schoolLevel:null,yearLevel:null,groups:[],records:[]}],query:{groupBy:'YEAR',bucket:'all',includeRows:false,status:'ALL',q:'',page:1,pageSize:25},selectedGroup:null});
  assert.equal(result.breakdown[0].bucketKey,'none');
});
test('missing academic details never widen scoped eligibility', () => {
  const student={schoolLevel:null,groups:[]};
  assert.equal(isStudentInEvent(student,{category:'ALL',includedGroups:[]}),true);
  for (const category of ['HOUSE','SECTION','SHS','COLLEGE'] as const) assert.equal(isStudentInEvent(student,{category,includedGroups:[{slug:'fixture'}]}),false);
});
