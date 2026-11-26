'use client';
import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import { ArrowLeft,ArrowRight,RefreshCw } from 'lucide-react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { useConfirm } from '@/globals/contexts/ConfirmModalContext';
import { Button } from '@/globals/components/shad-cn/button';
import { useTeacherOnboarding } from '../../hooks/useTeacherOnboarding';
import { useClassroomCommand } from '../../hooks/useClassroomCommand';
import { useJourneyNavigation } from '../../hooks/useJourneyNavigation';
import { resolveJourneyScreen,journeyScreens,journeyGrace,reviewCheckpoint,mergeConfirmedJourneyClass,canonicalJourneyExceptions,type JourneyReview,type JourneyScreen,type Replay } from '../../utils/onboardingJourney';
import { classSchema,classPatchSchema } from '../../schemas/classSchema';
import { firstClassDraftSchema } from '../../schemas/onboardingSchema';
import { rosterSchema } from '../../schemas/rosterSchema';
import type { TeacherOnboardingState } from '../../types/onboarding';
import type { AcademicTermOption,SubjectOption,ClassDetails,ClassSchedule,ClassException,ClassList } from '../../types/class';
import { LoadingState,Feedback,ClassroomSelect } from '../ui';
import { ClassNameField,AttendanceFields } from '../ClassFields';
import SectionPicker from '../SectionPicker';
import CatalogCreateSheet from '../CatalogCreateSheet';
import HelpButton from '../help/HelpButton';
import { GuideIllustration } from '../help/TeacherLesson';
import PracticeLesson from './PracticeLesson';
import JourneyRoster from './JourneyRoster';
const plain=canonicalJourneyExceptions;
const sorted=(ids:string[])=>JSON.stringify([...ids].sort());
export default function TeacherOnboarding(){
 const flow=useTeacherOnboarding();const {user}=useAuth();
 if(user?.role==='ADMIN')return <section className="mx-auto max-w-xl space-y-5 px-4 py-8"><h1 className="text-3xl font-semibold">Help teachers get ready</h1><p>Teachers set up their own classes. Review classes or open the teacher guide to assist them.</p><Link className="flex min-h-12 items-center text-indigo-700 underline" href="/class/admin/classes">Review classes</Link><Link className="flex min-h-12 items-center text-indigo-700 underline" href="/class/help">Teacher guide & help</Link></section>;
 if(flow.query.isLoading)return <div className="mx-auto max-w-xl px-4 py-12"><LoadingState label="Loading saved setup…"/></div>;
 if(!flow.query.data)return <div className="mx-auto max-w-xl px-4 py-12"><Feedback title="Unable to load saved setup" onRetry={()=>void flow.query.refetch()}>Your confirmed work remains saved. Reload progress before creating a class.</Feedback></div>;
 return <Journey flow={flow} state={flow.query.data}/>;
}
function Journey({flow,state}:{flow:ReturnType<typeof useTeacherOnboarding>;state:TeacherOnboardingState}){
 const router=useRouter();const params=useSearchParams();const {user}=useAuth();const confirm=useConfirm();const edit=useClassroomCommand();const client=useQueryClient();
 const replay:Replay=params.get('replay')==='introduction'?'introduction':params.get('replay')==='practice'?'practice':null;
 const screen=resolveJourneyScreen(params.get('screen'),state.nextStep,replay);
 const [base,setBase]=useState(state.class);const saved=base&&base.id===state.classId?base:null;
 const draft=state.draft.classForm;
 const [name,setName]=useState(state.class?.displayName??draft?.displayName??'');const [termId,setTerm]=useState(state.class?.termId??draft?.termId??'');const [subjectId,setSubject]=useState(state.class?.subjectId??draft?.subjectId??'');
 const [sectionIds,setSections]=useState(state.class?.sections.map(row=>row.sectionId)??draft?.sectionIds??[]);const [exceptions,setExceptions]=useState<ClassException[]>(state.class?.exceptions??[]);
 const [grace,setGrace]=useState(String(state.class?.graceMinutes??draft?.graceMinutes??15));const [schedule,setSchedule]=useState<ClassSchedule|null>(state.class?.schedule??draft?.schedule??null);
 const [selectedTerm,setSelectedTerm]=useState(state.draftChoices.term);const [selectedSubject,setSelectedSubject]=useState(state.draftChoices.subject);const [search,setSearch]=useState('');const [q,setQ]=useState('');const [chosen,setChosen]=useState('');const [classPage,setClassPage]=useState(1);const [catalog,setCatalog]=useState<'term'|'subject'|null>(null);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [rosterReview,setRosterReview]=useState<JourneyReview|null>(null);const [working,setWorking]=useState(false);const doing=useRef(false);const retryEdit=useRef<(()=>Promise<void>)|null>(null);const retryProgress=useRef<(()=>Promise<void>)|null>(null);const heading=useRef<HTMLDivElement>(null);
 const graceValue=journeyGrace(grace);
 const draftValue={displayName:name,...(termId?{termId}:{}),...(subjectId?{subjectId}:{}),sectionIds,graceMinutes:graceValue??Number.NaN,schedule};
 const initialDraft=useRef(JSON.stringify(draftValue));
 const configChanged=!!saved&&(name!==saved.displayName||graceValue===null||graceValue!==saved.graceMinutes||JSON.stringify(schedule)!==JSON.stringify(saved.schedule));
 const rosterChanged=!!saved&&(sorted(sectionIds)!==sorted(saved.sections.map(row=>row.sectionId))||JSON.stringify(plain(exceptions))!==JSON.stringify(plain(saved.exceptions)));
 const dirty=!replay&&(saved?configChanged||rosterChanged:JSON.stringify(draftValue)!==initialDraft.current);
 const blocked=flow.query.isError||working||edit.busy||edit.unconfirmed||flow.command.busy||flow.command.unconfirmed;const {permitExit,withInternalNavigation}=useJourneyNavigation(blocked,dirty);
 const go=useCallback((next:JourneyScreen,replace=false)=>{const url=new URL(window.location.href);url.searchParams.set('screen',next);withInternalNavigation(()=>window.history[replace?'replaceState':'pushState'](null,'',url.pathname+url.search));},[withInternalNavigation]);
 useEffect(()=>{if(params.get('screen')!==screen&&!blocked)go(screen,true);},[params,screen,blocked,go]); // canonicalize unavailable substeps without changing saved progress
 useEffect(()=>{heading.current?.focus();window.scrollTo({top:0,behavior:'instant'});},[screen]);
 useEffect(()=>{const timer=setTimeout(()=>setQ(search.trim()),250);return()=>clearTimeout(timer);},[search]);
 const terms=useQuery({queryKey:['classroom','terms'],enabled:!saved&&!replay,queryFn:()=>fetchApi<{items:AcademicTermOption[]}>('/api/classroom/terms?pageSize=100')});
 const subjects=useQuery({queryKey:['classroom','setup-subjects',q],enabled:!saved&&!replay,queryFn:({signal})=>fetchApi<{items:SubjectOption[]}>('/api/classroom/subjects?'+new URLSearchParams({q,pageSize:'100'}),{signal})});
 const classes=useQuery({queryKey:['classroom','setup-owned',user?.id,classPage],enabled:!saved&&!replay&&state.nextStep!=='WELCOME',queryFn:()=>fetchApi<ClassList>('/api/classroom/classes?pageSize=100&page='+classPage)});
 useEffect(()=>{if(saved||termId||draft?.termId||!terms.data)return;const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const current=terms.data.items.filter(row=>row.startDate<=today&&row.endDate>=today);if(current.length===1)setTerm(current[0].id);},[terms.data,saved,termId,draft?.termId]);
 // An existing-class selection is the only time an entirely new draft is loaded.
 useEffect(()=>{if(state.class&&state.class.id!==base?.id){const value=state.class;setBase(value);setName(value.displayName);setTerm(value.termId);setSubject(value.subjectId);setSections(value.sections.map(row=>row.sectionId));setExceptions(value.exceptions);setGrace(String(value.graceMinutes));setSchedule(value.schedule);}},[state.class,base?.id]);
 const perform=async(action:()=>Promise<void>)=>{if(doing.current)return;doing.current=true;setWorking(true);setError('');setNotice('');try{await action();}catch{setError('Unable to refresh saved progress. Your draft is retained. Reload saved progress before continuing.');}finally{doing.current=false;setWorking(false);}};
 const leave=()=>{permitExit();router.push('/class/classes');};
 const progress=async(payload:Record<string,unknown>,after:()=>Promise<void>|void)=>{
  const send=async(retry=false)=>{if(await (retry?flow.retrySave():flow.save(payload))){retryProgress.current=null;const latest=await flow.query.refetch();if(latest.isError)throw Error();await after();}};
  retryProgress.current=()=>send(true);await send();
 };
 const sendEdit=async(path:string,method:'POST'|'PUT'|'PATCH',payload:Record<string,unknown>,after:(value:ClassDetails)=>Promise<void>)=>{
  const send=async()=>{const value=await edit.run<ClassDetails>(path,method,payload);if(!value)return;retryEdit.current=null;setBase(previous=>mergeConfirmedJourneyClass(previous,value,path.endsWith('/roster')?'roster':'config'));await after(value);};
  retryEdit.current=send;await send();
 };
 const refresh=async()=>{const latest=await flow.query.refetch();if(latest.isError)throw Error();return latest.data!;};
 const persistEdits=async(after:(confirmed?:ClassDetails)=>Promise<void>|void,scope:'all'|'config'|'roster'|'name'='all')=>{
  if(scope!=='roster'&&scope!=='name'&&graceValue===null){setError('Enter a whole-number grace period from 0 to 180 minutes.');return;}
  if(!saved){await after();return;}
  const saveConfig=scope!=='roster'&&(scope==='name'?name!==saved.displayName:configChanged);
  const saveRoster=(scope==='all'||scope==='roster')&&rosterChanged;
  const patch={...(name!==saved.displayName?{displayName:name}:{}),...(scope!=='name'&&Number(grace)!==saved.graceMinutes?{graceMinutes:Number(grace)}:{}),...(scope!=='name'&&JSON.stringify(schedule)!==JSON.stringify(saved.schedule)?{schedule}:{})};
  const settings=classPatchSchema.safeParse({commandId:crypto.randomUUID(),expectedConfigRevision:saved.configRevision,...patch});
  const roster=rosterSchema.safeParse({commandId:crypto.randomUUID(),expectedRosterRevision:saved.rosterRevision,sectionIds,exceptions:plain(exceptions)});
  if(saveConfig&&!settings.success){setError(settings.error.issues[0]?.message??'Check attendance settings.');return;}
  if(saveRoster&&!roster.success){setError(roster.error.issues[0]?.message??'Check roster choices.');return;}
  let confirmed=saved;
  const finish=async()=>{await refresh();await after(confirmed);};
  const writeRoster=async()=>{if(saveRoster&&roster.success)await sendEdit('/api/classroom/classes/'+encodeURIComponent(saved.id)+'/roster','PUT',roster.data,async value=>{confirmed=mergeConfirmedJourneyClass(confirmed,value,'roster');await finish();});else await finish();};
  if(saveConfig&&settings.success)await sendEdit('/api/classroom/classes/'+encodeURIComponent(saved.id),'PATCH',settings.data,async value=>{confirmed=mergeConfirmedJourneyClass(confirmed,value,'config');await writeRoster();});else await writeRoster();
 };
 const acknowledge=async(step:'ROSTER'|'SETTINGS',displayed:ClassDetails)=>{
  const latest=await refresh();
  if(step==='ROSTER'&&!latest.readiness?.rosterCount){setError('Your empty class is saved. Add at least one student before confirming the roster.');return;}
  const reviewed=step==='ROSTER'?rosterReview:{classId:displayed.id,configRevision:displayed.configRevision,rosterRevision:displayed.rosterRevision,rosterFingerprint:''};
  const checkpoint=reviewed?reviewCheckpoint(latest,reviewed,step):null;
  if(!checkpoint){setError(step==='ROSTER'?'The roster changed. Reload saved progress and review the current students before continuing.':'The attendance settings changed. Reload saved progress and review the current settings before continuing.');return;}
  await progress(checkpoint,()=>go(step==='ROSTER'?'settings':latest.nextStep==='READY'?'ready':'practice-scan'));
 };
 const saveExit=()=>perform(async()=>{if(replay||state.completedAt){leave();return;}if(saved){await persistEdits(leave);return;}if(graceValue===null){setError('Enter a whole-number grace period from 0 to 180 minutes.');return;}const parsed=firstClassDraftSchema.safeParse(draftValue);if(!parsed.success){setError(parsed.error.issues[0]?.message??'Check your draft.');return;}await progress({step:'DRAFT',draft:{classForm:parsed.data}},()=>{initialDraft.current=JSON.stringify(draftValue);leave();});});
 const continueSetup=()=>perform(async()=>{
  if(screen==='intro-class'){go('intro-scan');return;}
  if(screen==='intro-scan'){if(replay){router.push('/class/help');return;}if(state.nextStep==='WELCOME')await progress({step:'WELCOME'},()=>go('basics'));else go('basics');return;}
  if(screen==='basics'){
   if(!name.trim()||(!saved&&(!termId||!subjectId))){setError('Choose an academic term and subject, and enter a class name.');return;}
   if(saved)await persistEdits(()=>go('sections'),'name');else go('sections');return;
  }
  if(screen==='sections'){
   if(saved){await persistEdits(()=>go('roster'),'roster');return;}
   const parsed=classSchema.safeParse({commandId:crypto.randomUUID(),termId,subjectId,displayName:name,graceMinutes:graceValue??Number.NaN,schedule,sectionIds,exceptions:[],onboardingExpectedRevision:state.revision});
   if(!parsed.success){setError(parsed.error.issues[0]?.message??'Check your class details.');return;}
   await sendEdit('/api/classroom/classes','POST',parsed.data,async()=>{await refresh();go('roster');});return;
  }
  if(screen==='roster'||screen==='settings'){await persistEdits(async confirmed=>{if(!confirmed)return;if(screen==='roster'&&rosterChanged){setNotice('Your roster is saved. Review the updated students, then continue.');go('roster');return;}await acknowledge(screen==='roster'?'ROSTER':'SETTINGS',confirmed);},screen==='roster'?'roster':'config');return;}
  if(screen==='ready'){if(state.completedAt)leave();else await progress({step:'READY',complete:true},leave);}
 });
 const finishPractice=(choice:'SEEN'|'SKIPPED')=>perform(async()=>{if(replay){router.push('/class/help');return;}await progress({step:'TUTORIAL',draft:{tutorial:choice}},()=>go('ready'));});
 const retry=()=>perform(async()=>{if(edit.unconfirmed&&retryEdit.current)await retryEdit.current();else if(flow.command.unconfirmed&&retryProgress.current)await retryProgress.current();});
 const reload=()=>perform(async()=>{
  if(edit.unconfirmed||flow.command.unconfirmed)return;
  const latest=await refresh();
  if(dirty&&!await confirm({title:'Discard unsaved edits and load saved setup?',description:'The current saved class or setup draft replaces your local edits. Choose Cancel to keep editing.'}))return;
  const value=latest.class;const savedDraft=latest.draft.classForm;
  setBase(value);setName(value?.displayName??savedDraft?.displayName??'');setTerm(value?.termId??latest.draftChoices.term?.id??'');setSubject(value?.subjectId??latest.draftChoices.subject?.id??'');
  setSelectedTerm(latest.draftChoices.term);setSelectedSubject(latest.draftChoices.subject);setGrace(String(value?.graceMinutes??savedDraft?.graceMinutes??15));setSchedule(value?.schedule??savedDraft?.schedule??null);setSections(value?.sections.map(row=>row.sectionId)??savedDraft?.sectionIds??[]);setExceptions(value?.exceptions??[]);
  if(!value)initialDraft.current=JSON.stringify({displayName:savedDraft?.displayName??'',...(latest.draftChoices.term?{termId:latest.draftChoices.term.id}:{}),...(latest.draftChoices.subject?{subjectId:latest.draftChoices.subject.id}:{}),sectionIds:savedDraft?.sectionIds??[],graceMinutes:savedDraft?.graceMinutes??15,schedule:savedDraft?.schedule??null});
  setRosterReview(null);if(value)await client.invalidateQueries({queryKey:['classroom','roster',user?.id,value.id]});
  edit.clearError();flow.command.clearError();
 });
 const practice=screen.startsWith('practice');const intro=screen.startsWith('intro');const chapter=intro?0:practice||screen==='ready'?2:1;
 const title=screen==='intro-class'?'A little setup. A smoother school day.':screen==='intro-scan'?'Your phone. Their familiar QR cards.':screen==='basics'?'Let’s set up your class':screen==='sections'?'Who’s in your class?':screen==='roster'?'Review your students':screen==='settings'?'Make attendance work for you':'Your class is ready';
 const back=()=>{if(blocked)return;if(state.completedAt&&!replay){leave();return;}if(replay){if(screen==='intro-scan')go('intro-class');else if(screen==='practice-manual')go('practice-scan');else if(screen==='practice-finalize')go('practice-manual');else router.push('/class/help');return;}const index=journeyScreens.indexOf(screen);if(index>0)go(journeyScreens[index-1]);else void saveExit();};
 const completed=!!state.completedAt&&!replay;
 return <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-5 text-slate-800 [overflow-wrap:anywhere] [&_fieldset]:min-w-0 sm:px-8">
 <header className="flex flex-wrap items-center justify-between gap-3 py-4"><Button type="button" variant="ghost" className="min-h-12 px-0 text-indigo-800" disabled={blocked} onClick={back}><ArrowLeft aria-hidden className="size-4"/>Back</Button><span className="text-sm font-semibold text-indigo-950">Classroom</span><Button type="button" variant="ghost" className="min-h-12 px-0 text-indigo-800" disabled={blocked} onClick={()=>void saveExit()}>{replay?'Exit replay':completed?'My classes':'Save and exit'}</Button></header>
 <nav aria-label="Setup progress" className="mb-8"><ol className="grid grid-cols-3 gap-3">{['Meet Classroom','Set up your class','Try attendance'].map((label,index)=><li key={label} aria-current={chapter===index?'step':undefined} className="min-w-0"><div aria-hidden className={'mb-2 h-1.5 rounded-full '+(index<=chapter?'bg-indigo-500':'bg-indigo-100')}/><p className={'text-xs leading-5 '+(index===chapter?'font-semibold text-indigo-900':'text-slate-500')}>{label}</p></li>)}</ol></nav>
 <div ref={heading} tabIndex={-1} className="min-w-0 flex-1 outline-none [&_h1]:break-words">
 {notice?<p role="status" className="mb-4 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">{notice}</p>:null}
 {flow.query.isError?<Feedback title="Unable to refresh saved progress" onRetry={()=>void flow.query.refetch()}>Your draft is retained. Reload progress before continuing.</Feedback>:null}
 <div hidden={!practice}><PracticeLesson screen={screen} busy={blocked} onNavigate={go} onDone={()=>void finishPractice('SEEN')}/></div>
 {!practice?<section className="space-y-6 pb-6">{intro||screen==='ready'?<GuideIllustration kind={screen==='intro-scan'?'scan':screen==='ready'?'ready':'class'}/>:null}<p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">{replay?'Replay · no changes saved':completed?'Setup complete':chapter===0?'A warm welcome':chapter===1?'Your reusable class':'You’re ready'}</p><h1 className="text-3xl leading-tight font-semibold tracking-tight text-indigo-950 sm:text-4xl">{title}</h1>
 {screen==='intro-class'?<><p className="text-lg leading-8 text-slate-600">Save your class once. Your sections and individual roster choices will be ready for every meeting.</p><p className="text-sm leading-6 text-slate-500">We’ll prepare one class together, then try attendance with fictional students.</p></>:null}
 {screen==='intro-scan'?<><p className="text-lg leading-8 text-slate-600">You scan students’ existing QR cards. You stay in control of when attendance starts and finishes.</p><p className="text-sm leading-6 text-slate-500">You can always mark students manually. Classroom never starts a real meeting during setup.</p><HelpButton topic="scanning"/></>:null}
 {screen==='basics'?<><p className="leading-7 text-slate-600">One class brings together your subject, academic term and reusable roster.</p>{state.classUnavailable?<Feedback tone="warning" title="Your previous class is unavailable">Choose another class you own or create a new one.</Feedback>:null}{!saved?<>{classes.isError?<Feedback title="Unable to load your existing classes" onRetry={()=>void classes.refetch()}/>:null}{classes.data?.items.some(item=>item.primaryTeacherId===user?.id)?<div className="space-y-3 rounded-2xl border border-indigo-100 bg-white p-4"><ClassroomSelect label="Use an existing class" value={chosen} disabled={blocked} onValueChange={setChosen} options={[{value:'',label:'Choose one of my classes'},...classes.data.items.filter(item=>item.primaryTeacherId===user?.id).map(item=>({value:item.id,label:item.displayName}))]}/><Button type="button" className="min-h-12 w-full" variant="outline" disabled={blocked||!chosen} onClick={()=>void perform(async()=>{await progress({step:'CLASS',classId:chosen},()=>go('roster'));})}>Continue with this class</Button></div>:null}{classes.data&&classes.data.total>100?<div className="flex gap-3"><Button type="button" variant="outline" disabled={blocked||classPage===1} onClick={()=>setClassPage(value=>value-1)}>Previous classes</Button><Button type="button" variant="outline" disabled={blocked||classPage*100>=classes.data.total} onClick={()=>setClassPage(value=>value+1)}>Next classes</Button></div>:null}</>:null}<fieldset disabled={blocked} className="space-y-5">{saved?<div className="space-y-2 rounded-2xl bg-indigo-50 p-4 text-sm"><p>Subject: {saved.subject.title}</p><p>Academic term: {saved.term.name}</p><p className="text-slate-500">Subject and term remain fixed after creation.</p></div>:<><ClassroomSelect label="Academic term" value={termId} disabled={blocked||terms.isLoading} onValueChange={value=>{setTerm(value);setSelectedTerm(terms.data?.items.find(row=>row.id===value)??null);}} options={[{value:'',label:'Choose an academic term'},...(selectedTerm?.id===termId&&!terms.data?.items.some(row=>row.id===termId)?[{value:selectedTerm.id,label:selectedTerm.name}]:[]),...(terms.data?.items??[]).map(row=>({value:row.id,label:row.name}))]}/><Button type="button" variant="ghost" className="min-h-12 text-indigo-700" onClick={()=>setCatalog('term')}>Add missing term</Button><label className="block text-sm font-medium">Find subject<input className="mt-2 min-h-12 w-full rounded-xl border bg-white px-3" value={search} maxLength={100} onChange={event=>setSearch(event.target.value)}/></label><ClassroomSelect label="Subject" value={subjectId} disabled={blocked||subjects.isLoading} onValueChange={value=>{setSubject(value);setSelectedSubject(subjects.data?.items.find(row=>row.id===value)??null);if(!name){const row=subjects.data?.items.find(item=>item.id===value);if(row)setName(row.title+' — Class A');}}} options={[{value:'',label:'Choose a subject'},...(selectedSubject?.id===subjectId&&!subjects.data?.items.some(row=>row.id===subjectId)?[{value:selectedSubject.id,label:(selectedSubject.code?selectedSubject.code+' · ':'')+selectedSubject.title}]:[]),...(subjects.data?.items??[]).map(row=>({value:row.id,label:(row.code?row.code+' · ':'')+row.title}))]}/><Button type="button" variant="ghost" className="min-h-12 text-indigo-700" onClick={()=>setCatalog('subject')}>Add missing subject</Button>{subjects.isError||terms.isError?<Feedback title="Unable to load the catalog" onRetry={()=>{void terms.refetch();void subjects.refetch();}}/>:null}</>}<ClassNameField value={name} onChange={setName} disabled={blocked}/></fieldset><HelpButton topic="setup"/></>:null}
 {screen==='sections'?<><p className="leading-7 text-slate-600">Choose the official sections you teach. Their students are included automatically.</p><SectionPicker selected={sectionIds} onChange={setSections} disabled={blocked} initialLabels={saved?.sections.map(row=>({id:row.sectionId,name:row.name}))}/><p className="rounded-xl bg-indigo-50 p-4 text-sm leading-6">You can create an empty class now. Add at least one student before confirming the roster on the next screen.</p><HelpButton topic="rosters"/></>:null}
 {screen==='roster'&&saved?<><JourneyRoster onReview={setRosterReview} saved={saved} exceptions={exceptions} onChange={setExceptions} disabled={blocked}/><Button type="button" className="min-h-12 w-full" variant="outline" disabled={blocked} onClick={()=>go('sections')}>Change sections</Button></>:null}
 {screen==='settings'?<><p className="leading-7 text-slate-600">Choose when arrivals count as Late. You’ll review the actual start time before each meeting.</p><AttendanceFields grace={grace} onGrace={setGrace} schedule={schedule} onSchedule={setSchedule} disabled={blocked}/><HelpButton topic="starting"/></>:null}
 {screen==='ready'?<><div className="space-y-3 rounded-2xl border border-indigo-100 bg-white p-5"><p className="break-words text-lg font-semibold">{state.class?.displayName??'Your saved classes'}</p>{state.class?<><p className="break-words text-sm text-slate-600">{state.class.subject.title} · {state.class.term.name}</p><p className="break-words text-sm text-slate-600">{state.class.sections.map(row=>row.name).join(' + ')||'Individual student roster'}</p><p className="text-sm text-slate-600">{state.readiness?.rosterCount} students · {state.class.graceMinutes} minute grace · Asia/Manila</p></>:<p className="text-sm">Your completion is saved. Open your classes to find your currently available classes.</p>}</div><p className="leading-7 text-slate-600">Your class is ready for your next meeting. Start attendance when you are ready; you’ll review and confirm before a real meeting begins.</p><Link className="flex min-h-12 items-center justify-center text-indigo-700 underline" href="/class/help">Teacher guide & help</Link></>:null}
 </section>:null}
 </div>
 {error||edit.error||flow.command.error?<div role="alert" className="my-4 space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><p>{error||edit.error||flow.command.error}</p>{edit.unconfirmed||flow.command.unconfirmed?<Button type="button" className="min-h-12 w-full" disabled={working||edit.busy||flow.command.busy} onClick={()=>void retry()}><RefreshCw aria-hidden className="size-4"/>Retry same save</Button>:<Button type="button" variant="outline" className="min-h-12 w-full" disabled={working} onClick={()=>void reload()}>Reload saved progress</Button>}</div>:null}
 {practice?<Button type="button" variant="ghost" className="mb-5 min-h-12 w-full text-indigo-700" disabled={blocked} onClick={()=>void finishPractice('SKIPPED')}>{replay?'Return to teacher guide':'Skip practice'}</Button>:<footer className="sticky bottom-0 space-y-2 border-t border-indigo-100 bg-white/95 py-4 backdrop-blur-sm"><Button type="button" className="min-h-12 w-full rounded-xl bg-indigo-600 hover:bg-indigo-700" disabled={blocked} onClick={()=>void continueSetup()}>{working?'Saving…':screen==='sections'&&!saved?'Create class':screen==='ready'?'Open my classes':screen==='intro-class'?'Meet Classroom':screen==='intro-scan'&&replay?'Return to teacher guide':intro?'Let’s set up a class':screen==='basics'&&!saved?'Choose sections':'Save and continue'}<ArrowRight aria-hidden className="size-4 shrink-0"/></Button>{intro&&!replay?<Button type="button" variant="ghost" className="min-h-12 w-full text-indigo-700" disabled={blocked} onClick={()=>void perform(async()=>{if(state.nextStep==='WELCOME')await progress({step:'WELCOME'},()=>go('basics'));else go('basics');})}>Skip introduction</Button>:null}{screen==='ready'&&state.classId?<Button type="button" variant="outline" className="min-h-12 w-full" disabled={blocked} onClick={()=>void perform(async()=>{const start=()=>{permitExit();router.push('/class/classes/'+encodeURIComponent(state.classId!)+'/start');};if(state.completedAt)start();else await progress({step:'READY',complete:true},start);})}>Start attendance</Button>:null}</footer>}
 {catalog?<CatalogCreateSheet kind={catalog} onClose={()=>setCatalog(null)} onChoose={value=>{if('startDate'in value){setTerm(value.id);setSelectedTerm(value);}else {setSubject(value.id);setSelectedSubject(value);if(!name)setName(value.title+' — Class A');}setCatalog(null);}}/>:null}
 </div>;
}
