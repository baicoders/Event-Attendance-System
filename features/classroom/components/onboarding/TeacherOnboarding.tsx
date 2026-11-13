'use client';
import Link from 'next/link';
import { useAuth } from '@/globals/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import PageHeader from '@/globals/components/shared/PageHeader';
import { Button } from '@/globals/components/shad-cn/button';
import { useTeacherOnboarding } from '../../hooks/useTeacherOnboarding';
import WelcomeStep from './WelcomeStep';
import FirstClassStep from './FirstClassStep';
import RosterReviewStep from './RosterReviewStep';
import AttendanceSettingsStep from './AttendanceSettingsStep';
import QrTutorialStep from './QrTutorialStep';
import ReadyStep from './ReadyStep';
const steps=['WELCOME','CLASS','ROSTER','SETTINGS','TUTORIAL','READY'] as const;
const labels={WELCOME:'Welcome',CLASS:'First class',ROSTER:'Review roster',SETTINGS:'Attendance settings',TUTORIAL:'QR and manual practice',READY:'Ready',COMPLETED:'Completed'};
export default function TeacherOnboarding({help=false}:{help?:boolean}){
  const {user}=useAuth();const administrator=user?.role==='ADMIN';const {query,save,command,retrySave}=useTeacherOnboarding();const router=useRouter();
  const state=query.data;const blocked=command.busy||command.unconfirmed;
  const refresh=()=>void query.refetch();
  if(administrator&&!help)return <section className="mx-auto max-w-2xl space-y-4 px-4 py-6"><PageHeader eyebrow="Class administration" title="Help teachers get ready" description="Teachers complete their classroom setup and start attendance. You can manage classes and assist with existing sessions."/><Button asChild variant="outline"><Link href="/class/admin/classes">Review classes</Link></Button><Button asChild variant="outline"><Link href="/class/onboarding?help=1">Classroom workflow help</Link></Button></section>;
  return <div className="mx-auto min-w-0 max-w-3xl space-y-6 px-4 py-6 sm:px-6"><PageHeader eyebrow="Class" title={help?'Classroom help':'Set up classroom attendance'} description="Use your phone, your saved class roster and students’ existing QR codes."/>
  <Link className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline" href="/class">← My Classes</Link>
  {query.isLoading?<p role="status">Loading saved setup…</p>:query.isError?<div role="alert"><p>Unable to load setup. Your confirmed work remains saved.</p><Button className="min-h-12" onClick={refresh}>Retry setup</Button></div>:state?<>
  {help?<QrTutorialStep help/>:state.completedAt?<section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-xl font-semibold">Setup completed</h2><p>Your classes and roster choices remain saved. Open a class to take attendance; you do not need to repeat onboarding.</p><Link className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline" href="/class">Open My Classes</Link><QrTutorialStep help/></section>:<>
  <nav aria-label="Setup progress"><ol className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-slate-200 py-4 text-sm sm:grid-cols-3">{steps.map((step,index)=>{const current=step===state.nextStep;const complete=steps.indexOf(state.nextStep as typeof steps[number])>index;return <li key={step} aria-current={current?'step':undefined} className={current?'flex min-w-0 items-center gap-2 font-semibold text-indigo-700':'flex min-w-0 items-center gap-2 text-slate-600'}><span aria-hidden className={current?'flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white':complete?'flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs text-indigo-800':'flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs'}>{complete?'✓':index+1}</span><span className="min-w-0 break-words">{labels[step]}</span></li>})}</ol></nav><p className="text-sm font-medium text-indigo-800" aria-live="polite">Step {steps.indexOf(state.nextStep as typeof steps[number])+1} of {steps.length}: {labels[state.nextStep]}</p>
  {state.nextStep==='WELCOME'?<WelcomeStep busy={blocked} retry={command.unconfirmed} onContinue={()=>void save({step:'WELCOME'})}/>:null}
  {state.nextStep==='CLASS'?<FirstClassStep key="first-class" state={state} busy={command.busy} retry={command.unconfirmed} onSave={save} onRefresh={refresh}/>:null}
  {state.nextStep==='ROSTER'?<RosterReviewStep key={state.classId} state={state} busy={blocked} retry={command.unconfirmed} onSave={save} onRefresh={refresh}/>:null}
  {state.nextStep==='SETTINGS'?<AttendanceSettingsStep state={state} busy={blocked} retry={command.unconfirmed} onSave={save} onRefresh={refresh}/>:null}
  {state.nextStep==='TUTORIAL'?<QrTutorialStep busy={blocked} retry={command.unconfirmed} onFinish={choice=>void save({step:'TUTORIAL',draft:{tutorial:choice}})}/>:null}
  {state.nextStep==='READY'?<ReadyStep state={state} busy={blocked} canStart={!administrator} onFinish={async(start)=>{if(await save({step:'READY',complete:true}))router.replace(start&&!administrator&&state.classId?'/class/classes/'+encodeURIComponent(state.classId)+'/start':'/class');}}/>:null}
  </>}
  {command.error?<div role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{command.error}</p>{command.unconfirmed?<Button className="min-h-12 w-full" disabled={command.busy} onClick={()=>void retrySave()}>Retry same progress save</Button>:<Button className="min-h-12 w-full" variant="outline" onClick={()=>{command.clearError();refresh();}}>Reload saved progress</Button>}</div>:null}
  </>:null}</div>;
}
