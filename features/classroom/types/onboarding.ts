import type { OnboardingStep } from '../utils/onboarding';
import type { SavedOnboardingDraft } from '../schemas/onboardingSchema';
import type { ClassDetails,AcademicTermOption,SubjectOption } from './class';
export type TeacherOnboardingState={
  revision:number;flowVersion:number;completedAt:string|null;nextStep:OnboardingStep;
  classId:string|null;class:ClassDetails|null;classUnavailable:boolean;
  draft:SavedOnboardingDraft;draftChoices:{term:AcademicTermOption|null;subject:SubjectOption|null};
  readiness:{classId:string;rosterCount:number;rosterRevision:number;configRevision:number;rosterFingerprint:string}|null;
};
