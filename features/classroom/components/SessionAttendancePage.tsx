'use client';
import { AttendanceStatusIcon } from './ui';
import { ScanLine, ListChecks, BarChart3, Pencil, CircleMinus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError,fetchApi } from '@/globals/utils/api';
import PageHeader from '@/globals/components/shared/PageHeader';
import FormInput from '@/globals/components/shared/FormInput';
import { Button } from '@/globals/components/shad-cn/button';
import { useClassroomSession } from '../hooks/useClassroomSession';
import { useClassroomRoster } from '../hooks/useClassroomRoster';
import { useClassroomAttendance } from '../hooks/useClassroomAttendance';
import { useFocusedRoster } from '../hooks/useFocusedRoster';
import { attendanceLabels,type SessionRosterPage,type SessionMember,type AttendanceStatus,type AttendanceRecord,type FinalAttendanceStatus,type AttendanceStudentDisplay } from '../types/attendance';
import { clampRosterPage,mergeConfirmedAttendance,attendanceConfirmation } from '../utils/manualRosterState';
import { parseAttendanceView,attendanceViewParams } from '../utils/attendanceView';
import ManualRoster from './ManualRoster';
import FocusedAttendance from './FocusedAttendance';
import ClassroomScanner from './ClassroomScanner';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/globals/components/shad-cn/dropdown-menu';
import SessionSummary from './SessionSummary';
import FinalizeSessionSheet from './FinalizeSessionSheet';
import AttendanceCorrectionSheet from './AttendanceCorrectionSheet';
import AttendanceActionSheet from './AttendanceActionSheet';
import ExcuseSheet from './ExcuseSheet';
import IneligibleStudentSheet,{ineligibleChoice,type IneligibleChoice} from './IneligibleStudentSheet';
import SessionEnrollmentSheet from './SessionEnrollmentSheet';
import SessionPolicySheet from './SessionPolicySheet';
import PendingAttendanceCommands from './PendingAttendanceCommands';

export default function SessionAttendancePage({sessionId}:{sessionId:string}){
 const {user}=useAuth();const client=useQueryClient();const query=useClassroomSession(sessionId);const session=query.data;
 const [mode,setMode]=useState<'MANUAL'|'SCAN'>('MANUAL');const [manualView,setManualView]=useState<'FOCUS'|'ROSTER'>('FOCUS');
 const [search,setSearch]=useState('');const [q,setQ]=useState('');const [status,setStatus]=useState<AttendanceStatus|''>('');const [page,setPage]=useState(1);const [includeExcluded,setIncludeExcluded]=useState(false);const [viewReady,setViewReady]=useState(false);
 const focused=manualView==='FOCUS'&&session?.state==='ACTIVE';
 const roster=useClassroomRoster(sessionId,q,focused?'UNMARKED':status,focused?1:page,focused?false:includeExcluded);
 const focus=useFocusedRoster(sessionId,q,roster.data,roster.dataUpdatedAt,focused&&viewReady);
 const [departing,setDeparting]=useState<SessionMember|null>(null);const [savingMember,setSavingMember]=useState<SessionMember|null>(null);const [recoveryMember,setRecoveryMember]=useState<SessionMember|null>(null);
 const [lastSaved,setLastSaved]=useState<AttendanceRecord|null>(null);const [reviewMember,setReviewMember]=useState<SessionMember|null>(null);const [reviewing,setReviewing]=useState(false);
 const [feedback,setFeedback]=useState('');const [rowErrors,setRowErrors]=useState<Record<string,string>>({});const [reason,setReason]=useState('');const [action,setAction]=useState<'FINALIZE'|'CANCEL'|'POLICY'|null>(null);
 const [edit,setEdit]=useState<{member:SessionMember;status?:FinalAttendanceStatus}|null>(null);const [enrollment,setEnrollment]=useState<SessionMember|null>(null);const [ineligible,setIneligible]=useState<IneligibleChoice|null>(null);const anchor=useRef<(()=>void)|null>(null);
 useEffect(()=>{const restore=()=>{if(window.location.pathname.startsWith('/account/'))return;const view=parseAttendanceView(new URLSearchParams(window.location.search));setSearch(view.q);setQ(view.q);setStatus(view.status);setPage(view.page);setIncludeExcluded(view.includeExcluded);setMode(view.mode);setManualView(view.manualView);setViewReady(true);};restore();window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[sessionId]);
 useEffect(()=>{if(!viewReady||window.location.pathname.startsWith('/account/'))return;const url=new URL(window.location.href);url.search=attendanceViewParams({q,status,page,includeExcluded,mode,manualView}).toString();window.history.replaceState(window.history.state,'',url);},[q,status,page,includeExcluded,mode,manualView,viewReady]);
 useEffect(()=>{if(search.trim()===q)return;const timer=setTimeout(()=>{setQ(search.trim());setPage(1);},250);return()=>clearTimeout(timer);},[search,q]);
 useEffect(()=>{if(!focused&&roster.data)setPage(value=>clampRosterPage(value,roster.data.filteredCount));},[roster.data,focused]);
 useEffect(()=>{if(!departing)return;const timer=setTimeout(()=>setDeparting(null),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);return()=>clearTimeout(timer);},[departing]);
 const refresh=()=>{anchor.current?.();void client.invalidateQueries({queryKey:['classroom','session',user?.id,sessionId]});void client.invalidateQueries({queryKey:['classroom','session-roster',user?.id,sessionId]});void client.invalidateQueries({queryKey:['classroom','classes',user?.id]});void client.invalidateQueries({queryKey:['classroom','overview']});void client.invalidateQueries({queryKey:['classroom','meetings']});};
 const commands=useClassroomAttendance('SESSION',sessionId,{
  onConfirmed:(entry,value)=>{
   const result=value as {attendance?:AttendanceRecord|null;outcome?:string;studentId?:string;student?:AttendanceStudentDisplay;scope?:string;state?:string};
   anchor.current?.();const confirmedStudent=result.studentId??entry.payload.studentId;if(typeof confirmedStudent==='string')setRowErrors(current=>{const next={...current};delete next[confirmedStudent];return next;});
   if(result.attendance){
    const record=result.attendance;
    const knownRow=[focus.current,recoveryMember,...(roster.data?.items??[])].find(row=>row?.studentId===record.studentId);
    const student=result.student??knownRow?.studentSnapshot;
    const name=student?[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' ').trim():'';
    const identifiers=student?[student.usn?'USN: '+student.usn:'',student.lrn?'LRN: '+student.lrn:''].filter(Boolean).join(' · '):'';
    setFeedback(name?attendanceConfirmation(knownRow?.attendance,record,result.outcome,name)+(identifiers?' '+identifiers:''):'Attendance saved.');
    if(focused&&focus.current?.studentId===record.studentId)setDeparting(focus.current);
    focus.confirm(record);setLastSaved(record);
    // Confirm locally before refetching. A failed read cannot turn a valid save
    // into an uncertain operation, and older reads cannot downgrade revisions.
    void client.cancelQueries({queryKey:['classroom','session-roster',user?.id,sessionId]});
    client.setQueriesData<SessionRosterPage>({queryKey:['classroom','session-roster',user?.id,sessionId]},old=>old?{...old,items:old.items.map(member=>member.studentId===record.studentId?{...member,attendance:mergeConfirmedAttendance(member.attendance,record)}:member)}:old);
   }else setFeedback(entry.kind==='ADJUSTMENT'?(result.scope==='CLASS_ONLY'?'Saved for future meetings. No attendance recorded in this session.':'Session enrollment saved. Review the student’s attendance.'):(entry.kind==='FINALIZE'?'Finalization saved. The session summary shows its current status.':entry.kind==='CANCEL'?'Session canceled. No new absences were created.':'Session policy saved.'));
   setSavingMember(null);setEdit(null);setEnrollment(null);setAction(null);setIneligible(null);setReviewMember(null);refresh();
  },
  onProblem:(entry,error)=>{
   if(typeof entry.payload.studentId==='string')setRowErrors(current=>({...current,[String(entry.payload.studentId)]:error instanceof Error?error.message:'Attendance could not be confirmed.'}));
   const choice=ineligibleChoice(error,String(entry.payload.code??''));if(choice){setIneligible(choice);setMode('MANUAL');}
   if(error instanceof ApiError&&['STUDENT_NOT_IN_SESSION','ATTENDANCE_CHANGED','REVISION_CONFLICT','SESSION_CHANGED','SESSION_ROSTER_CHANGED','ROSTER_CHANGED','SESSION_FINALIZED','SESSION_CANCELED'].includes(error.code??''))refresh();
  },
 });
 const pendingStudent=commands.pending.find(entry=>typeof entry.payload.studentId==='string')?.payload.studentId;
 useEffect(()=>{
  if(typeof pendingStudent!=='string'){setRecoveryMember(null);return;}
  let stopped=false;const controller=new AbortController();
  void fetchApi<SessionRosterPage>('/api/classroom/sessions/'+encodeURIComponent(sessionId)+'/roster?'+new URLSearchParams({q:pendingStudent,page:'1',pageSize:'100',includeExcluded:'true'}),{signal:controller.signal}).then(value=>{if(!stopped)setRecoveryMember(value.items.find(member=>member.studentId===pendingStudent)??null);}).catch(()=>{});
  return()=>{stopped=true;controller.abort();};
 },[pendingStudent,sessionId]);
 const assisting=!!session&&session.currentPrimaryTeacherId!==user?.id;
 const authorityError=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);
 const blocked=commands.pending.length>0||!commands.ready;const reasonNeeded=assisting&&reason.trim().length<3;
 const disabled=!session||session.state==='CANCELED'||query.isError||roster.isError||reasonNeeded||!viewReady;
 function mark(member:SessionMember,next:FinalAttendanceStatus){
  if(!session||blocked||disabled||departing||reviewing||focus.checking)return;
  commands.clearError();focus.clearNotice();setRowErrors(current=>{const errors={...current};delete errors[member.studentId];return errors;});
  if(member.attendance.status!=='UNMARKED'||session.state==='FINALIZED'||next==='EXCUSED'){setEdit({member,status:next});return;}
  setSavingMember(member);anchor.current?.();void commands.submit('MANUAL',{sessionId,studentId:member.studentId,status:next,expectedRevision:member.attendance.revision,...(assisting?{reason:reason.trim()}:{})});
 }
 function saveEdit(correctionReason:string,note:string,next:FinalAttendanceStatus){if(!edit||blocked)return;if(focused&&edit.member.studentId===focus.current?.studentId)setSavingMember(edit.member);anchor.current?.();void commands.submit('MANUAL',{sessionId,studentId:edit.member.studentId,status:next,expectedRevision:edit.member.attendance.revision,...(edit.status==='EXCUSED'?{excuseNote:note}:{}),...(correctionReason||assisting?{reason:correctionReason||reason.trim()}:{})});}
 async function reviewLast(){
  if(!lastSaved||blocked)return;setReviewing(true);commands.clearError();
  try{const value=await fetchApi<SessionRosterPage>('/api/classroom/sessions/'+encodeURIComponent(sessionId)+'/roster?'+new URLSearchParams({q:lastSaved.studentId,page:'1',pageSize:'100',includeExcluded:'true'}));const member=value.items.find(row=>row.studentId===lastSaved.studentId);if(member)setReviewMember(member);else setFeedback('This student is unavailable. Open Roster to review the session.');}
  catch{setFeedback('Attendance remains saved. Unable to load the mark for review. Try again.');}finally{setReviewing(false);}
 }
 const shortcutsEnabled=mode==='MANUAL'&&session?.state==='ACTIVE'&&!edit&&!reviewMember&&!action&&!enrollment&&!ineligible;
 const counts=roster.data?.counts??session?.counts;
 const current=departing??(blocked?(savingMember??recoveryMember??undefined):focus.current);
 return <div className="mx-auto min-w-0 max-w-[1280px] space-y-5 px-4 py-6 sm:px-6">
  <Link href={user?.role==='ADMIN'?'/class/admin/classes':'/class/classes'} className="inline-flex min-h-12 items-center text-sm font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-600">{user?.role==='ADMIN'?'← Classroom classes':'← My Classes'}</Link>
  {query.isLoading?<p role="status">Loading attendance session…</p>:authorityError?<p role="alert">This session is unavailable. Return to My Classes to check your access.</p>:session?<>
   <PageHeader eyebrow="Class attendance" title={session.classSnapshot.displayName} description={session.classSnapshot.subject.title}/>
   {query.isError?<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Session could not refresh. Confirmed attendance is saved. Reconnect before continuing.</p>:null}
   <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
    <div className="min-w-0 space-y-4">
     {assisting?<FormInput label="Reason for assisting this teacher" minLength={3} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} description="Your name and reason are recorded for every administrative change."/>:null}
     {session.showFirstAttendanceGuidance?<p className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">Scan or mark students, wait for confirmation, then finalize this meeting. Camera and manual modes use the same saved session.</p>:null}
     <div role="group" aria-label="Attendance entry mode" className="grid grid-cols-2 gap-2"><Button variant={mode==='SCAN'?'default':'outline'} aria-pressed={mode==='SCAN'} disabled={session.state!=='ACTIVE'||disabled||blocked} onClick={()=>setMode('SCAN')}><ScanLine aria-hidden className="size-4 shrink-0"/>Scan QR</Button><Button variant={mode==='MANUAL'?'default':'outline'} aria-pressed={mode==='MANUAL'} onClick={()=>setMode('MANUAL')}><ListChecks aria-hidden className="size-4 shrink-0"/>Manual attendance</Button></div>
     <div role="status" aria-label="Attendance save status" aria-live="polite" className="sticky top-20 z-20 flex min-h-12 items-center break-words rounded-xl bg-indigo-50 p-3 text-sm font-medium text-indigo-900 shadow-sm lg:top-3">{commands.pending.some(entry=>entry.state==='UNCONFIRMED')?'Save not confirmed. Check the same save.':blocked?'Checking attendance saves…':feedback||'Choose a student’s attendance result.'}</div>
     {commands.error?<div role="alert" className="break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{commands.error}</div>:null}
     <PendingAttendanceCommands items={commands.pending} onRetry={id=>void commands.retry(id)}/>
     {mode==='SCAN'&&session.state==='ACTIVE'&&!authorityError&&!disabled?<ClassroomScanner paused={blocked} onRead={code=>void commands.scan(code,assisting?reason.trim():undefined)} onManual={()=>setMode('MANUAL')}/>:focused?<FocusedAttendance shortcutsEnabled={shortcutsEnabled} member={current} counts={counts} loading={roster.isLoading||!viewReady||!commands.ready||(blocked&&!current)} disabled={disabled||focus.checking||reviewing} saving={blocked} leaving={!!departing} error={roster.isError?'Roster could not refresh. Confirmed saves remain saved. Reconnect and refresh to continue.':current?rowErrors[current.studentId]:undefined} notice={focus.notice} q={search} onSearch={setSearch} onMark={mark} onReview={lastSaved?()=>void reviewLast():undefined} onRoster={()=>setManualView('ROSTER')} onRetry={()=>{void roster.refetch();void query.refetch();}}/>:<>
      {session.state==='ACTIVE'?<div className="flex justify-end"><Button variant="outline" onClick={()=>setManualView('FOCUS')}>Focus on unmarked</Button></div>:null}
      <ManualRoster onCorrect={session.state==='FINALIZED'?member=>{commands.clearError();setEdit({member});}:undefined} shortcutsEnabled={shortcutsEnabled} data={roster.data} loading={roster.isLoading} settling={blocked||roster.isFetching} error={roster.isError} onRetry={()=>{anchor.current?.();void roster.refetch();void query.refetch();}} q={search} onSearch={setSearch} status={status} onFilter={value=>{setStatus(value);setPage(1);}} page={page} onPage={setPage} pending={commands.pending} rowErrors={rowErrors} onRetrySave={id=>void commands.retry(id)} disabled={disabled||blocked} onMark={mark} onEnrollment={member=>{commands.clearError();setEnrollment(member);}} includeExcluded={includeExcluded} onIncludeExcluded={value=>{setIncludeExcluded(value);setPage(1);}} anchorRegister={anchor}/>
     </>}
    </div>
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-4"><SessionSummary session={session} counts={counts}/><Button asChild variant="outline" className="w-full"><Link href={'/class/reports?'+new URLSearchParams({sessionId:session.id,classId:session.classId,termId:session.classSnapshot.term.id})}><BarChart3 aria-hidden className="size-4 shrink-0"/>View session report</Link></Button></aside>
   </div>
   {session.state!=='CANCELED'?<div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:bottom-3">
    {session.state==='ACTIVE'?<Button className="min-w-0 flex-1 sm:flex-none" aria-label="Review and finalize attendance" disabled={blocked||disabled||!!departing} onClick={()=>{commands.clearError();setAction('FINALIZE');}}>Review &amp; finalize</Button>:null}
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Session options <span aria-hidden>⌄</span></Button></DropdownMenuTrigger><DropdownMenuContent side="top" align="end">
     {session.state==='ACTIVE'?<DropdownMenuItem disabled={blocked||disabled} onSelect={()=>{commands.clearError();setAction('POLICY');}}><Pencil aria-hidden className="size-4 shrink-0"/>Adjust late policy</DropdownMenuItem>:null}
     <DropdownMenuItem variant="destructive" disabled={blocked||disabled} onSelect={()=>{commands.clearError();setAction('CANCEL');}}><CircleMinus aria-hidden className="size-4 shrink-0"/>Cancel session</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
   </div>:null}
   {reviewMember?<AttendanceActionSheet open title="Review last mark" description={reviewMember.studentSnapshot.firstName+' '+reviewMember.studentSnapshot.lastName+' · '+attendanceLabels[reviewMember.attendance.status]} onClose={()=>setReviewMember(null)}><p className="text-sm text-slate-600">Choose the corrected result. A reason is required for changes.</p><div className="grid grid-cols-2 gap-3">{(['PRESENT','ABSENT','LATE','EXCUSED'] as const).map(value=><Button key={value} variant="outline" disabled={blocked||!reviewMember.included} onClick={()=>{setEdit({member:reviewMember,status:value});setReviewMember(null);}}><AttendanceStatusIcon status={value}/>{value==='EXCUSED'?'Excuse':attendanceLabels[value]}</Button>)}</div>{!reviewMember.included?<p className="text-sm">This student is excluded. Open Roster to review enrollment.</p>:null}</AttendanceActionSheet>:null}
   {action==='FINALIZE'||action==='CANCEL'?<FinalizeSessionSheet key={action} session={{...session,counts:counts??session.counts}} cancel={action==='CANCEL'} assisting={assisting} busy={blocked} error={commands.error} onClose={()=>setAction(null)} onConfirm={value=>void commands.submit(action,{expectedLifecycleRevision:session.lifecycleRevision,...(action==='FINALIZE'?{expectedSnapshotRevision:session.snapshotRevision}:{}),...(value?{reason:value}:{})})}/>:null}
   {action==='POLICY'?<SessionPolicySheet session={session} busy={blocked} error={commands.error} onClose={()=>setAction(null)} onSave={payload=>void commands.submit('POLICY',payload)}/>:null}
   {edit?(edit.status==='EXCUSED'?<ExcuseSheet key={edit.member.studentId+edit.status} member={edit.member} requiresReason={edit.member.attendance.status!=='UNMARKED'||session.state==='FINALIZED'} busy={blocked} error={commands.error} onClose={()=>setEdit(null)} onSave={saveEdit}/>:<AttendanceCorrectionSheet key={edit.member.studentId+edit.status} member={edit.member} status={edit.status} requiresReason busy={blocked} error={commands.error} onClose={()=>setEdit(null)} onSave={saveEdit}/>):null}
   {ineligible?<IneligibleStudentSheet choice={ineligible} busy={blocked} error={commands.error} onClose={()=>setIneligible(null)} onSave={payload=>void commands.submit('ADJUSTMENT',{sessionId,...payload})}/>:null}
   {enrollment?<SessionEnrollmentSheet member={enrollment} session={session} busy={blocked} error={commands.error} onClose={()=>setEnrollment(null)} onSave={payload=>void commands.submit('ADJUSTMENT',{sessionId,...payload})}/>:null}
  </>:<div role="alert"><p>Attendance could not load.</p><Button onClick={()=>void query.refetch()}><RefreshCw aria-hidden className="size-4 shrink-0"/>Retry session</Button></div>}
 </div>;
}
