import test from 'node:test';
import assert from 'node:assert/strict';
import {getStudentDataIssues} from './dataIssues';
const group=(category:string)=>({category,slug:category.toLowerCase()});
const partial={usn:null,lrn:'000000123456',schoolLevel:null,yearLevel:null,groups:[]};
test('partial records report missing academics without treating LRN-only identity as an issue',()=>{
 const issues=getStudentDataIssues(partial);
 assert.deepEqual(issues.sort(),['MISSING_HOUSE','MISSING_SCHOOL_LEVEL','MISSING_SECTION','MISSING_YEAR_LEVEL']);
});
test('completeness is context aware and either identifier is legitimate',()=>{
 const common={...partial,schoolLevel:'SHS',yearLevel:'GRADE_11',groups:['HOUSE','SECTION','STRAND'].map(group)};
 assert.deepEqual(getStudentDataIssues(common),[]);
 assert.deepEqual(getStudentDataIssues({...common,usn:'00000123456',lrn:null}),[]);
 const college={...common,schoolLevel:'COLLEGE',yearLevel:'YEAR_1',groups:['HOUSE','SECTION'].map(group)};
 assert.deepEqual(getStudentDataIssues(college),['MISSING_PROGRAM','MISSING_DEPARTMENT']);
});
test('issues recalculate from saved records immediately without stored flags',()=>{
 const before={...partial,schoolLevel:'SHS',yearLevel:'GRADE_11',groups:['SECTION','STRAND'].map(group)};
 assert.deepEqual(getStudentDataIssues(before),['MISSING_HOUSE']);
 assert.deepEqual(getStudentDataIssues({...before,groups:[...before.groups,group('HOUSE')]}),[]);
 assert.deepEqual(getStudentDataIssues({...partial,usn:null,lrn:null}).filter(code=>code==='MISSING_USN'||code==='MISSING_LRN'),['MISSING_USN','MISSING_LRN']);
});
test('employees never receive student academic issues',()=>{
 assert.deepEqual(getStudentDataIssues({...partial,groups:[{category:'SECTION',slug:'employees'}]}),[]);
});

test('full-name search works when middle name is absent and preserves identifier search',async()=>{
 const {matchesStudentIssueSearch}=await import('./dataIssues');
 const student={firstName:'Synthetic',middleName:null,lastName:'Student',usn:null,lrn:'000000123456'};
 assert.equal(matchesStudentIssueSearch(student,'Synthetic Student'),true);
 assert.equal(matchesStudentIssueSearch(student,'Synthetic  Student'),true);
 assert.equal(matchesStudentIssueSearch(student,'000000123456'),true);
 assert.equal(matchesStudentIssueSearch(student,'Different'),false);
});
