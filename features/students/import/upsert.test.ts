import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStudentImport} from './classify';
import {parseStudentImportCsv} from './csv';
const house={id:'house',slug:'blue',name:'Blue',category:'HOUSE'};
const section={id:'section',slug:'a',name:'A',category:'SECTION'};
const row=(usn='',lrn='')=>({id:'',usn,lrn,firstName:'Synthetic',lastName:'Student',middleName:'',schoolLevel:'',yearLevel:'',section:'',house:'',department:'',program:'',strand:''});
const existing=(id:string,usn:string|null,lrn:string|null)=>({id,usn,lrn,firstName:'Synthetic',lastName:'Student',middleName:null,schoolLevel:null,yearLevel:null,createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01'),groups:[house,section]});
const review=(students:ReturnType<typeof existing>[],values:ReturnType<typeof row>[])=>classifyStudentImport({students,groups:[house,section],rows:values.map((student,i)=>({csvRow:i+2,student}))});
test('minimal USN or LRN CSV headers do not require optional columns',()=>{
 for(const identifier of ['usn','lrn']) {
 const parsed=parseStudentImportCsv(`${identifier},firstName,lastName\n${identifier==='usn'?'00000123456':'000000123456'},Synthetic,Student`);
 assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,1);
 }
});
test('USN match adds LRN and preserves missing group and academic information',()=>{
 const result=review([existing('canonical','00000123456',null)],[row('00000123456','000000123456')]);
 assert.equal(result.rows[0].status,'UPDATE');assert.equal(result.rows[0].student.id,'canonical');
 assert.deepEqual(result.rows[0].changes,[{field:'lrn',before:null,after:'000000123456'}]);
 assert.deepEqual(result.rows[0].groupIds.sort(),['house','section']);
});
test('LRN match adds USN while both identifiers resolve a single existing student',()=>{
 const result=review([existing('canonical',null,'000000123456')],[row('00000123456','000000123456')]);
 assert.equal(result.rows[0].status,'UPDATE');assert.equal(result.rows[0].student.id,'canonical');
 assert.deepEqual(result.rows[0].changes,[{field:'usn',before:null,after:'00000123456'}]);
 assert.equal(review([existing('canonical','00000123456','000000123456')],[row('00000123456','000000123456')]).rows[0].status,'UNCHANGED');
});
test('split identities and repeated canonical targets are blocked',()=>{
 const students=[existing('one','00000123456',null),existing('two',null,'000000123456')];
 assert.equal(review(students,[row('00000123456','000000123456')]).rows[0].status,'BLOCKED');
 const duplicates=review([existing('one','00000123456','000000123456')],[row('00000123456'),row('','000000123456')]);
 assert.equal(duplicates.counts.blocked,2);
});
test('new LRN-only record, missing identifiers, repeated incoming LRN, and unknown mappings',()=>{
 assert.equal(review([],[row('','000000123456')]).rows[0].status,'CREATE');
 assert.equal(review([],[row()]).rows[0].status,'BLOCKED');
 assert.equal(review([],[row('','000000123456'),row('','000000123456')]).counts.blocked,2);
 const unknown=review([],[{...row('00000123456'),program:'unconfirmed-program'}]);
 assert.equal(unknown.rows[0].status,'BLOCKED');assert.equal(unknown.unknownGroups[0].slug,'unconfirmed-program');
});
