import test from 'node:test';
import assert from 'node:assert/strict';
import {planUswagBaseline,USWAG_BASELINE_ACCOUNTS,USWAG_BASELINE_EVENT} from './setup-baseline';
const groups=Array.from({length:7},(_,i)=>({id:`group-${i}`,category:'CUSTOM'}));
test('plans four active test accounts and the approved October 26 all-day event',()=>{
 const p=planUswagBaseline([],[],groups);assert.deepEqual(p.blockers,[]);assert.equal(p.users.length,4);
 assert.equal(p.users.filter(u=>u.role==='ADMIN').length,1);assert.equal(p.users.filter(u=>u.role==='ORGANIZER').length,3);
 assert.ok(p.users.every(u=>u.action==='create'));assert.equal(p.event.action,'create');assert.equal(p.event.allDay,true);
 assert.equal(p.event.start,'2026-10-26T00:00:00+08:00');assert.equal(p.event.end,'2026-10-27T00:00:00+08:00');assert.equal(p.event.status,'APPROVED');assert.equal(p.event.groupIds.length,7);
});
test('reuses matching accounts and approved event without resetting capture mode',()=>{
 const users=USWAG_BASELINE_ACCOUNTS.map((u,i)=>({...u,id:`user-${i}`,status:'ACTIVE',mustChangePassword:false,credentialVersion:0}));
 const event={...USWAG_BASELINE_EVENT,id:'existing-event',groupIds:groups.map(g=>g.id),createdById:'user-1',reviewedById:'user-0',reviewedAt:'2026-10-25T00:00:00Z',status:'APPROVED',category:'CUSTOM',isTimeout:true,recordCount:1};
 const p=planUswagBaseline(users,[event],groups);assert.deepEqual(p.blockers,[]);assert.ok(p.users.every(u=>u.action==='reuse'));assert.equal(p.event.action,'reuse');assert.equal(p.event.id,'existing-event');
});
test('conflicting roles and attendance-bearing event changes block the baseline',()=>{
 const users=USWAG_BASELINE_ACCOUNTS.map((u,i)=>({...u,id:`user-${i}`,status:'ACTIVE',mustChangePassword:false,credentialVersion:0}));users[0].role='ORGANIZER';
 const p=planUswagBaseline(users,[{...USWAG_BASELINE_EVENT,id:'existing',title:'USWAG 2026',category:'ALL',status:'APPROVED',groupIds:[],createdById:'user-1',recordCount:1}],groups);
 assert.ok(p.blockers.includes('BASELINE_ACCOUNT_CONFLICT:admin@uswag.test'));assert.ok(p.blockers.includes('BASELINE_EVENT_HAS_ATTENDANCE'));
});
test('an existing draft without attendance is planned for configuration and approval',()=>{
 const p=planUswagBaseline([],[{...USWAG_BASELINE_EVENT,id:'draft',status:'DRAFT',category:'CUSTOM',groupIds:[],createdById:null,recordCount:0}],groups);
 assert.deepEqual(p.blockers,[]);assert.equal(p.event.action,'approve');assert.equal(p.event.id,'draft');
});
test('noncanonical or ambiguous account emails block instead of advertising unusable logins',()=>{
 const admin={...USWAG_BASELINE_ACCOUNTS[0],id:'existing',email:'ADMIN@USWAG.TEST',status:'ACTIVE',mustChangePassword:false,credentialVersion:0};
 assert.ok(planUswagBaseline([admin],[],groups).blockers.includes('BASELINE_ACCOUNT_CONFLICT:admin@uswag.test'));
 assert.ok(planUswagBaseline([admin,{...admin,id:'second',email:'admin@uswag.test'}],[],groups).blockers.includes('BASELINE_ACCOUNT_CONFLICT:admin@uswag.test'));
});
