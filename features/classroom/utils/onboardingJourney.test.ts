import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveJourneyScreen, practiceAttendance, journeyGrace, reviewCheckpoint, mergeConfirmedJourneyClass, canonicalJourneyExceptions } from './onboardingJourney';
test('URL screens cannot bypass server readiness or replay setup on completed accounts',()=>{
 assert.equal(resolveJourneyScreen('ready','CLASS'), 'basics');
 assert.equal(resolveJourneyScreen('practice-finalize','ROSTER'), 'roster');
 assert.equal(resolveJourneyScreen('intro-scan','WELCOME'),'intro-scan');
 assert.equal(resolveJourneyScreen('sections','SETTINGS'),'sections');
 assert.equal(resolveJourneyScreen('basics','COMPLETED'),'ready');
 assert.equal(resolveJourneyScreen('nonsense','TUTORIAL'),'practice-scan');
 assert.equal(resolveJourneyScreen('intro-class','COMPLETED','introduction'),'intro-class');
 assert.equal(resolveJourneyScreen('ready','CLASS','practice'),'practice-scan');
});
test('fictional practice finalization changes only remaining Unmarked students',()=>{
 const scanned=practiceAttendance({alex:'Unmarked',bea:'Unmarked',cai:'Unmarked'},{type:'scan'});
 assert.deepEqual(scanned,{alex:'Present',bea:'Unmarked',cai:'Unmarked'});
 const manual=practiceAttendance(scanned,{type:'manual',status:'Excused'});
 assert.deepEqual(manual,{alex:'Present',bea:'Excused',cai:'Unmarked'});
 assert.deepEqual(practiceAttendance(manual,{type:'finalize'}),{alex:'Present',bea:'Excused',cai:'Absent'});
 assert.deepEqual(scanned,{alex:'Present',bea:'Unmarked',cai:'Unmarked'});
});

test('blank grace is invalid while an explicitly entered zero is valid',()=>{
 assert.equal(journeyGrace(''),null);assert.equal(journeyGrace('  '),null);
 assert.equal(journeyGrace('0'),0);assert.equal(journeyGrace('15'),15);
 assert.equal(journeyGrace('-1'),null);assert.equal(journeyGrace('181'),null);
 assert.equal(journeyGrace('1.5'),null);
});
test('reviews acknowledge only the class and version actually displayed',()=>{
 const displayed={classId:'class-a',rosterRevision:2,configRevision:3,rosterFingerprint:'visible-fingerprint'};
 const current={revision:7,classId:'class-a',readiness:{...displayed,rosterCount:2}};
 assert.deepEqual(reviewCheckpoint(current,displayed,'ROSTER'),{step:'ROSTER',expectedRevision:7,expectedRosterRevision:2,rosterFingerprint:'visible-fingerprint'});
 assert.deepEqual(reviewCheckpoint(current,displayed,'SETTINGS'),{step:'SETTINGS',expectedRevision:7,expectedConfigRevision:3});
 assert.equal(reviewCheckpoint({...current,readiness:{...current.readiness,rosterRevision:3}},displayed,'ROSTER'),null);
 assert.equal(reviewCheckpoint({...current,readiness:{...current.readiness,rosterFingerprint:'new-profile'}},displayed,'ROSTER'),null);
 assert.equal(reviewCheckpoint({...current,readiness:{...current.readiness,configRevision:4}},displayed,'SETTINGS'),null);
 assert.equal(reviewCheckpoint({...current,classId:'class-b'},displayed,'SETTINGS'),null);
});

test('confirming roster edits never rebases unseen settings, or vice versa',()=>{
 const displayed={id:'class-a',displayName:'Displayed',graceMinutes:15,schedule:null,configRevision:2,rosterRevision:3,sections:[],exceptions:[],updatedAt:'old'};
 const response={...displayed,displayName:'Changed remotely',graceMinutes:25,configRevision:4,rosterRevision:5,updatedAt:'new'};
 const roster=mergeConfirmedJourneyClass(displayed,response,'roster');
 assert.equal(roster.rosterRevision,5);assert.equal(roster.configRevision,2);assert.equal(roster.graceMinutes,15);assert.equal(roster.displayName,'Displayed');
 const settings=mergeConfirmedJourneyClass(displayed,response,'config');
 assert.equal(settings.configRevision,4);assert.equal(settings.graceMinutes,25);assert.equal(settings.rosterRevision,3);
});

test('a saved trimmed exception reason does not stay dirty and block roster review',()=>{
 assert.deepEqual(canonicalJourneyExceptions([{studentId:'b',kind:'INCLUDE',reason:'  Irregular enrollment  '},{studentId:'a',kind:'EXCLUDE',reason:' Not enrolled '}]),[{studentId:'a',kind:'EXCLUDE',reason:'Not enrolled'},{studentId:'b',kind:'INCLUDE',reason:'Irregular enrollment'}]);
});
