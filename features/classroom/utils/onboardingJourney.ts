import type { OnboardingStep } from './onboarding';
export const journeyScreens = ['intro-class','intro-scan','basics','sections','roster','settings','practice-scan','practice-manual','practice-finalize','ready'] as const;
export type JourneyScreen = typeof journeyScreens[number];
export type Replay = 'introduction' | 'practice' | null;
const checkpoints: Record<OnboardingStep, JourneyScreen> = {WELCOME:'intro-class',CLASS:'basics',ROSTER:'roster',SETTINGS:'settings',TUTORIAL:'practice-scan',READY:'ready',COMPLETED:'ready'};
export function resolveJourneyScreen(requested: string | null, step: OnboardingStep, replay: Replay = null): JourneyScreen {
 if(replay){const allowed = replay==='introduction'?['intro-class','intro-scan']:['practice-scan','practice-manual','practice-finalize'];return allowed.includes(requested??'')?requested as JourneyScreen:allowed[0] as JourneyScreen;}
 if(step==='COMPLETED')return 'ready';
 const fallback=checkpoints[step];
 if(!journeyScreens.includes(requested as JourneyScreen))return fallback;
 const max=step==='WELCOME'?1:step==='CLASS'?3:step==='TUTORIAL'?8:journeyScreens.indexOf(fallback);
 return journeyScreens.indexOf(requested as JourneyScreen)<=max?requested as JourneyScreen:fallback;
}
export type PracticeStatus='Unmarked'|'Present'|'Late'|'Excused'|'Absent';
export type PracticeRoster=Record<'alex'|'bea'|'cai',PracticeStatus>;
export function practiceAttendance(roster:PracticeRoster,action:{type:'scan'}|{type:'manual';status:PracticeStatus}|{type:'finalize'}):PracticeRoster{
 if(action.type==='scan')return {...roster,alex:'Present'};
 if(action.type==='manual')return {...roster,bea:action.status};
 return Object.fromEntries(Object.entries(roster).map(([id,status])=>[id,status==='Unmarked'?'Absent':status])) as PracticeRoster;
}

/** A blank required input must never silently become a zero-minute policy. */
export function journeyGrace(input:string):number|null{
 if(!input.trim())return null;const value=Number(input);
 return Number.isInteger(value)&&value>=0&&value<=180?value:null;
}
export type JourneyReview={classId:string;configRevision:number;rosterRevision:number;rosterFingerprint:string};
export function reviewCheckpoint(current:{revision:number;classId:string|null;readiness:(JourneyReview&{rosterCount:number})|null},displayed:JourneyReview,step:'ROSTER'|'SETTINGS'){
 const ready=current.readiness;
 if(!ready||current.classId!==displayed.classId||ready.classId!==displayed.classId)return null;
 if(step==='ROSTER')return ready.rosterCount>0&&ready.rosterRevision===displayed.rosterRevision&&ready.rosterFingerprint===displayed.rosterFingerprint?{step,expectedRevision:current.revision,expectedRosterRevision:displayed.rosterRevision,rosterFingerprint:displayed.rosterFingerprint}:null;
 return ready.configRevision===displayed.configRevision?{step,expectedRevision:current.revision,expectedConfigRevision:displayed.configRevision}:null;
}

/** A confirmed edit may advance only the revisions that this teacher submitted. */
export function mergeConfirmedJourneyClass<T extends Pick<import('../types/class').ClassDetails,'id'|'displayName'|'graceMinutes'|'schedule'|'configRevision'|'rosterRevision'|'sections'|'exceptions'|'updatedAt'>>(previous:T|null,response:T,part:'roster'|'config'):T{
 if(!previous||previous.id!==response.id)return response;
 return part==='roster'?{...previous,sections:response.sections,exceptions:response.exceptions,rosterRevision:response.rosterRevision,updatedAt:response.updatedAt}:{...previous,displayName:response.displayName,graceMinutes:response.graceMinutes,schedule:response.schedule,configRevision:response.configRevision,updatedAt:response.updatedAt};
}

export function canonicalJourneyExceptions(rows:import('../types/class').ClassException[]){
 return rows.map(({studentId,kind,reason})=>({studentId,kind,reason:reason.trim()})).sort((a,b)=>a.studentId.localeCompare(b.studentId));
}
