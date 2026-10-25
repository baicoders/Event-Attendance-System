import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupPlan, type SetupState } from './setup-plan';
import type { SetupInput } from './setup-input';
import type { CanonicalRow } from '../../features/students/import/contract';

const incoming:CanonicalRow={id:'',usn:'00000000001',lrn:'',firstName:'Verified',lastName:'Student',middleName:'',schoolLevel:'COLLEGE',yearLevel:'YEAR_1',house:'azul',section:'',program:'',department:'',strand:''};
function fixture(){
 const input={rows:[{sourceRow:7,group:'SSC Officers',position:'President',student:{...incoming}}],groups:[{slug:'azul',name:'Azul',category:'HOUSE',approved:true}],hashes:{workbook:'synthetic'},blockers:[],held:[{sourceRow:99,group:'SSLG Officers',name:'Held Synthetic'}]} as SetupInput;
 const state:SetupState={groups:[],students:[],memberships:[],events:[],owners:[]};
 return {input,state};
}
test('plans student, house, seven officer groups and workbook position together',()=>{
 const {input,state}=fixture();const p=buildSetupPlan(input,state);
 assert.equal(p.students[0].action,'create');assert.equal(p.groups.length,8);
 assert.equal(p.memberships[0].position,'President');assert.equal(p.memberships[0].action,'create');assert.deepEqual(p.blockers,[]);
 assert.equal(p.event.readiness,'missing-inputs');
});
test('selects exclusively by approved USN and preserves ID, blank fields and unrelated groups',()=>{
 const {input,state}=fixture();state.groups=[{id:'house',slug:'azul',name:'Azul',category:'HOUSE'},{id:'year',slug:'year-1',name:'Year 1',category:'YEAR'}];
 state.students=[{...incoming,id:'original-qr',middleName:'Existing',usn:incoming.usn,lrn:'123456789012',schoolLevel:'COLLEGE',yearLevel:'YEAR_1',groups:state.groups,createdAt:'old',updatedAt:'old'}];
 const p=buildSetupPlan(input,state);assert.deepEqual(p.blockers,[]);assert.equal(p.students[0].id,'original-qr');assert.equal(p.students[0].action,'noop');
 assert.equal(p.students[0].student.lrn,'123456789012');assert.equal(p.students[0].student.middleName,'Existing');
});
test('an LRN or legacy ID match can never substitute for the approved USN',()=>{
 const {input,state}=fixture();state.students=[{id:'other',usn:'99999999999',lrn:incoming.usn!,firstName:'Verified',lastName:'Student',middleName:null,schoolLevel:null,yearLevel:null,groups:[],createdAt:'old',updatedAt:'old'}];
 const p=buildSetupPlan(input,state);assert.ok(p.blockers.length);assert.equal(p.students[0].action,'blocked');
});
test('preserves conflicting permanent house and existing custom organization',()=>{
 const {input,state}=fixture();state.groups=[{id:'red',slug:'roxxo',name:'Roxxo',category:'HOUSE'},{id:'other',slug:'custom-other',name:'Other',category:'CUSTOM'}];
 state.students=[{id:'original',usn:incoming.usn,lrn:null,firstName:'Verified',lastName:'Student',middleName:null,schoolLevel:'COLLEGE',yearLevel:'YEAR_1',groups:[state.groups[0]],createdAt:'old',updatedAt:'old'}];
 state.memberships=[{studentId:'original',groupId:'other',position:'Unrelated'}];
 const p=buildSetupPlan(input,state);assert.ok(p.blockers.length>=2);assert.equal(p.students[0].action,'blocked');assert.equal(p.memberships[0].action,'blocked');
});
test('pending academic definitions and wrong-category existing slugs block apply',()=>{
 const {input,state}=fixture();input.groups[0].approved=false;state.groups=[{id:'wrong',slug:'azul',name:'Azul',category:'SECTION'}];
 const p=buildSetupPlan(input,state);assert.ok(p.blockers.length);assert.equal(p.groups[0].action,'blocked');
});
test('existing event extra members are preserved and block readiness',()=>{
 const {input,state}=fixture();state.groups=[{id:'ssc',slug:'custom-ssc-officers',name:'SSC Officers',category:'CUSTOM'}];
 state.memberships=[{studentId:'extra',groupId:'ssc',position:'Existing'}];state.events=[{id:'event',title:'USWAG 2026',category:'CUSTOM',status:'APPROVED',groupIds:['ssc'],start:'2026-01-01T00:00:00Z',end:'2026-01-01T01:00:00Z',location:'Hall',createdById:'owner'}];
 const p=buildSetupPlan(input,state);assert.equal(p.event.readiness,'blocked');assert.equal(p.event.extraStudents,1);assert.equal(p.blockers.length,0);
});
test('draft creation reports extra members in reused groups and reuses its exact title on repeat',()=>{
 const {input,state}=fixture();state.groups=[{id:'ssc',slug:'custom-ssc-officers',name:'SSC Officers',category:'CUSTOM'}];
 state.memberships=[{studentId:'extra',groupId:'ssc',position:'Existing'}];
 state.owners=[{id:'owner',role:'ORGANIZER',status:'ACTIVE',mustChangePassword:false,credentialVersion:0}];
 const options={create:{ownerId:'owner',title:'Officer gathering',start:'2026-01-01T00:00:00+08:00',end:'2026-01-01T01:00:00+08:00',location:'Hall'}};
 const p=buildSetupPlan(input,state,options);assert.equal(p.event.extraStudents,1);assert.equal(p.event.readiness,'blocked');assert.deepEqual(p.blockers,[]);
 state.events=[{id:'draft',title:'Officer gathering',category:'CUSTOM',status:'DRAFT',groupIds:['ssc'],start:options.create.start,end:options.create.end,location:'Hall',createdById:'owner'}];
 assert.equal(buildSetupPlan(input,state,options).event.action,'reuse');
});
test('bootstrap checks the final seven-group audience before approving an existing partial draft',()=>{
 const {input,state}=fixture();state.groups=[{id:'ssc',slug:'custom-ssc-officers',name:'SSC Officers',category:'CUSTOM'},{id:'sslg',slug:'custom-sslg-officers',name:'SSLG Officers',category:'CUSTOM'}];
 state.memberships=[{studentId:'extra',groupId:'sslg',position:'Existing'}];
 state.events=[{id:'draft',title:'USWAG 2026',category:'CUSTOM',status:'DRAFT',groupIds:['ssc'],start:'2026-10-25T16:00:00Z',end:'2026-10-26T16:00:00Z',location:null,createdById:null,recordCount:0}];
 const p=buildSetupPlan(input,state,{},true);assert.ok(p.blockers.includes('BASELINE_EVENT_EXTRA_MEMBERS'));assert.equal(p.event.extraStudents,1);assert.equal(p.event.readiness,'blocked');
});
