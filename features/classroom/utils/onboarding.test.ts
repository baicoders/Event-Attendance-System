import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextOnboardingStep } from './onboarding';
const ready = { completed:false,welcomeSeen:true,classAvailable:true,rosterCount:3,rosterReviewed:true,settingsReviewed:true,tutorialDone:true };
test('setup resumes at the first missing prerequisite, never an obsolete stored URL',()=>{
 assert.equal(nextOnboardingStep({...ready,welcomeSeen:false}),'WELCOME');
 assert.equal(nextOnboardingStep({...ready,classAvailable:false}),'CLASS');
 assert.equal(nextOnboardingStep({...ready,rosterCount:0}),'ROSTER');
 assert.equal(nextOnboardingStep({...ready,rosterReviewed:false}),'ROSTER');
 assert.equal(nextOnboardingStep({...ready,settingsReviewed:false}),'SETTINGS');
 assert.equal(nextOnboardingStep({...ready,tutorialDone:false}),'TUTORIAL');
 assert.equal(nextOnboardingStep(ready),'READY');
});
test('completed teachers are not forced back through setup after class transfer or archive',()=>{
 assert.equal(nextOnboardingStep({...ready,completed:true,classAvailable:false,rosterCount:0}),'COMPLETED');
});

test('persisted setup drafts are bounded by UTF-8 bytes, not only character counts',async()=>{
 const { savedOnboardingDraftSchema }=await import('../schemas/onboardingSchema');
 assert.equal(savedOnboardingDraftSchema.safeParse({classForm:{sectionIds:Array(100).fill('é'.repeat(128))}}).success,false);
 assert.equal(savedOnboardingDraftSchema.safeParse({classForm:{displayName:'Programming 2',sectionIds:['section']}}).success,true);
});
