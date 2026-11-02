import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeRosterFromStudents,fingerprintClassRoster,type RosterStudent } from './composeRoster';
const student=(id:string,sections:string[],revision=0):RosterStudent=>({id,usn:id.padStart(11,'0'),lrn:null,firstName:'Student',lastName:id,middleName:null,schoolLevel:'COLLEGE',yearLevel:'YEAR_3',profileRevision:revision,archivedAt:null,groups:sections.map(id=>({id,slug:id,name:id,category:'SECTION'}))});
const config={classId:'class-a',rosterRevision:0,sectionIds:['3a','3b'],exceptions:[{studentId:'irregular-1',kind:'INCLUDE' as const,reason:'Irregular enrollment'},{studentId:'irregular-2',kind:'INCLUDE' as const,reason:'Irregular enrollment'},{studentId:'excluded',kind:'EXCLUDE' as const,reason:'Does not take subject'}]};
const students=[student('regular-a',['3a']),student('regular-b',['3b']),student('shared',['3a','3b']),student('excluded',['3a']),student('irregular-1',['other']),student('irregular-2',['other']),student('unrelated',['other'])];
test('combined sections union with persistent irregular additions and exclusion precedence',()=>{
 const roster=composeRosterFromStudents(students,config.sectionIds,config.exceptions);
 assert.deepEqual(roster.map(member=>member.studentId).sort(),['irregular-1','irregular-2','regular-a','regular-b','shared']);
 assert.equal(roster.filter(member=>member.studentId==='shared').length,1);
 assert.deepEqual(roster.find(member=>member.studentId==='irregular-1')?.studentSnapshot.groups.map(group=>group.id),['other']);
 for(let meeting=0;meeting<40;meeting++)assert.deepEqual(composeRosterFromStudents(students,config.sectionIds,config.exceptions),roster);
 const overridden=composeRosterFromStudents(students,config.sectionIds,[...config.exceptions,{studentId:'irregular-1',kind:'EXCLUDE',reason:'Excluded'}]);assert.ok(!overridden.some(member=>member.studentId==='irregular-1'));
});
test('fingerprint covers the entire roster, relevant content, revision and provenance independent of display order',()=>{
 const roster=composeRosterFromStudents(students,config.sectionIds,config.exceptions);const fingerprint=fingerprintClassRoster(roster,config);
 assert.equal(fingerprintClassRoster([...roster].reverse(),{...config,sectionIds:['3b','3a']}),fingerprint);
 assert.notEqual(fingerprintClassRoster(roster,{...config,rosterRevision:1}),fingerprint);
 const revised=students.map(value=>value.id==='regular-a'?{...value,firstName:'Corrected',profileRevision:1}:value);
 assert.notEqual(fingerprintClassRoster(composeRosterFromStudents(revised,config.sectionIds,config.exceptions),config),fingerprint);
 const transfer=students.map(value=>value.id==='regular-a'?student(value.id,['other'],1):value);
 assert.notEqual(fingerprintClassRoster(composeRosterFromStudents(transfer,config.sectionIds,config.exceptions),config),fingerprint);
});
test('unrelated classes share official sections without modifying directory membership; archived and employee identities are excluded',()=>{
 const before=JSON.stringify(students);const other=composeRosterFromStudents(students,['3a'],[]);
 assert.deepEqual(other.map(member=>member.studentId).sort(),['excluded','regular-a','shared']);assert.equal(JSON.stringify(students),before);
 const hidden=[{...student('archived',['3a']),archivedAt:new Date()}, {...student('employee',['3a']),groups:[...student('employee',['3a']).groups,{id:'employees',slug:'employees',name:'Employees',category:'HOUSE'}]}];
 assert.equal(composeRosterFromStudents(hidden,['3a'],hidden.map(value=>({studentId:value.id,kind:'INCLUDE' as const,reason:'Invalid include'}))).length,0);
});
