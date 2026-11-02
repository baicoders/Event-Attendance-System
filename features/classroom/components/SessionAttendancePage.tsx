'use client';
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError } from '@/globals/utils/api';
import PageHeader from '@/globals/components/shared/PageHeader';
import FormInput from '@/globals/components/shared/FormInput';
import { Button } from '@/globals/components/shad-cn/button';
import { useClassroomSession } from '../hooks/useClassroomSession';
import { useClassroomRoster } from '../hooks/useClassroomRoster';
import { useClassroomAttendance } from '../hooks/useClassroomAttendance';
import { type SessionRosterPage,type SessionMember,type AttendanceStatus,type AttendanceRecord,type FinalAttendanceStatus } from '../types/attendance';
import { clampRosterPage,mergeConfirmedAttendance,attendanceConfirmation } from '../utils/manualRosterState';
import ManualRoster from './ManualRoster';
import ClassroomScanner from './ClassroomScanner';
import SessionSummary from './SessionSummary';
import FinalizeSessionSheet from './FinalizeSessionSheet';
import AttendanceCorrectionSheet from './AttendanceCorrectionSheet';
import ExcuseSheet from './ExcuseSheet';
import IneligibleStudentSheet,{ineligibleChoice,type IneligibleChoice} from './IneligibleStudentSheet';
import SessionEnrollmentSheet from './SessionEnrollmentSheet';
import SessionPolicySheet from './SessionPolicySheet';
import PendingAttendanceCommands from './PendingAttendanceCommands';
export default function SessionAttendancePage({sessionId}:{sessionId:string}){
 const {user}=useAuth();const client=useQueryClient();const query=useClassroomSession(sessionId);const session=query.data;const [mode,setMode]=useState<'MANUAL'|'SCAN'>('MANUAL');const [search,setSearch]=useState('');const [q,setQ]=useState('');const [status,setStatus]=useState<AttendanceStatus|''>('');const [page,setPage]=useState(1);const [includeExcluded,setIncludeExcluded]=useState(false);const roster=useClassroomRoster(sessionId,q,status,page,includeExcluded);
 const [feedback,setFeedback]=useState('');const [reason,setReason]=useState('');const [action,setAction]=useState<'FINALIZE'|'CANCEL'|'POLICY'|null>(null);const [edit,setEdit]=useState<{member:SessionMember;status:FinalAttendanceStatus}|null>(null);const [enrollment,setEnrollment]=useState<SessionMember|null>(null);const [ineligible,setIneligible]=useState<IneligibleChoice|null>(null);const anchor=useRef<(()=>void)|null>(null);
 useEffect(()=>{if(search.trim()===q)return;const timer=setTimeout(()=>{setQ(search.trim());setPage(1);},250);return()=>clearTimeout(timer);},[search,q]);
 useEffect(()=>{if(roster.data)setPage(value=>clampRosterPage(value,roster.data.filteredCount));},[roster.data]);
 const refresh=()=>{anchor.current?.();void client.invalidateQueries({queryKey:['classroom','session',user?.id,sessionId]});void client.invalidateQueries({queryKey:['classroom','session-roster',user?.id,sessionId]});void client.invalidateQueries({queryKey:['classroom','classes',user?.id]});};
 const commands=useClassroomAttendance('SESSION',sessionId,{
  onConfirmed:(entry,value)=>{
   const result=value as {attendance?:AttendanceRecord|null;outcome?:string;studentId?:string;scope?:string;state?:string};
   anchor.current?.();
   if(result.attendance){const record=result.attendance;void client.cancelQueries({queryKey:['classroom','session-roster',user?.id,sessionId]});client.setQueriesData<SessionRosterPage>({queryKey:['classroom','session-roster',user?.id,sessionId]},old=>old?{...old,items:old.items.map(member=>member.studentId===record.studentId?{...member,attendance:mergeConfirmedAttendance(member.attendance,record)}:member)}:old);
    const knownRow=roster.data?.items.find(row=>row.studentId===record.studentId);const known=knownRow?.studentSnapshot;const label=known?known.firstName+' '+known.lastName:'student '+record.studentId;
    setFeedback(attendanceConfirmation(knownRow?.attendance,record,result.outcome,label));
   }else setFeedback(entry.kind==='ADJUSTMENT'?(result.scope==='CLASS_ONLY'?'Saved for future meetings. No attendance recorded in this session.':'Session enrollment saved. Review the student’s attendance.'):(entry.kind==='FINALIZE'?'Finalization saved. The session summary shows its current status.':entry.kind==='CANCEL'?'Session canceled. No new absences were created.':'Session policy saved.'));
   setEdit(null);setEnrollment(null);setAction(null);setIneligible(null);refresh();
  },
  onProblem:(entry,error)=>{setFeedback('');const choice=ineligibleChoice(error,String(entry.payload.code??''));if(choice){setIneligible(choice);setMode('MANUAL');}if(error instanceof ApiError&&['ATTENDANCE_CHANGED','SESSION_CHANGED','SESSION_ROSTER_CHANGED','ROSTER_CHANGED','SESSION_FINALIZED','SESSION_CANCELED'].includes(error.code??''))refresh();},
 });
 const assisting=!!session&&session.currentPrimaryTeacherId!==user?.id;const authorityError=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);const blocked=commands.pending.length>0;const reasonNeeded=assisting&&reason.trim().length<3;const disabled=!session||session.state==='CANCELED'||query.isError||roster.isError||reasonNeeded;
 function mark(member:SessionMember,next:FinalAttendanceStatus){if(!session)return;commands.clearError();setFeedback('');if(member.attendance.status!=='UNMARKED'||session.state==='FINALIZED'||next==='EXCUSED'){setEdit({member,status:next});return;}void commands.submit('MANUAL',{sessionId,studentId:member.studentId,status:next,expectedRevision:member.attendance.revision,...(assisting?{reason:reason.trim()}:{})});}
 function saveEdit(correctionReason:string,note:string){if(!edit)return;void commands.submit('MANUAL',{sessionId,studentId:edit.member.studentId,status:edit.status,expectedRevision:edit.member.attendance.revision,...(edit.status==='EXCUSED'?{excuseNote:note}:{}),...(correctionReason||assisting?{reason:correctionReason||reason.trim()}:{})});}
 return <div className="mx-auto min-w-0 max-w-3xl space-y-5 px-4 py-6 sm:px-6"><Link href="/class" className="flex min-h-12 items-center text-indigo-700 underline">← My Classes</Link>{query.isLoading?<p role="status">Loading attendance session…</p>:authorityError?<p role="alert">This session is unavailable. Return to My Classes to check your access.</p>:session?<><PageHeader eyebrow="Class attendance" title={session.classSnapshot.displayName} description={session.classSnapshot.subject.title}/>{query.isError?<p role="alert">Session could not refresh. Saved attendance remains on the server. Reconnect and reload before continuing.</p>:null}<SessionSummary session={session} counts={roster.data?.counts??session.counts}/>
 {assisting?<FormInput label="Reason for assisting this teacher" className="min-h-12" minLength={3} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} description="Your name and reason are recorded for every administrative change."/>:null}
 {session.showFirstAttendanceGuidance?<p className="rounded-xl bg-indigo-50 p-4 text-sm">Scan or mark students, wait for confirmation, then finalize this meeting. Camera and manual modes use the same saved session.</p>:null}
 <div role="group" aria-label="Attendance entry mode" className="grid grid-cols-2 gap-2"><Button className="min-h-12" variant={mode==='SCAN'?'default':'outline'} aria-pressed={mode==='SCAN'} disabled={session.state!=='ACTIVE'||disabled} onClick={()=>setMode('SCAN')}>Scan QR</Button><Button className="min-h-12" variant={mode==='MANUAL'?'default':'outline'} aria-pressed={mode==='MANUAL'} onClick={()=>setMode('MANUAL')}>Manual roster</Button></div>
 <div role="status" aria-live="polite" className="break-words text-sm font-semibold text-indigo-800">{feedback}</div>{commands.error?<div role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{commands.error}</div>:null}
 <PendingAttendanceCommands items={commands.pending} onRetry={id=>void commands.retry(id)}/>
 {mode==='SCAN'&&session.state==='ACTIVE'&&!authorityError&&!disabled?<ClassroomScanner paused={blocked} onRead={code=>void commands.scan(code,assisting?reason.trim():undefined)} onManual={()=>setMode('MANUAL')}/>:<ManualRoster data={roster.data} loading={roster.isLoading} error={roster.isError} onRetry={()=>{void roster.refetch();void query.refetch();}} q={search} onSearch={setSearch} status={status} onFilter={value=>{setStatus(value);setPage(1);}} page={page} onPage={setPage} pending={commands.pending} disabled={disabled} onMark={mark} onEnrollment={member=>{commands.clearError();setEnrollment(member);}} includeExcluded={includeExcluded} onIncludeExcluded={value=>{setIncludeExcluded(value);setPage(1);}} anchorRegister={anchor}/>}
 {session.state!=='CANCELED'?<div className="space-y-3 border-t pt-5">{session.state==='ACTIVE'?<><Button className="min-h-12 w-full" disabled={blocked||disabled} onClick={()=>{commands.clearError();setAction('FINALIZE');}}>Review and finalize attendance</Button><Button className="min-h-12 w-full" variant="outline" disabled={blocked||disabled} onClick={()=>{commands.clearError();setAction('POLICY');}}>Correct this meeting’s late policy</Button></>:null}<Button className="min-h-12 w-full" variant="outline" disabled={blocked||disabled} onClick={()=>{commands.clearError();setAction('CANCEL');}}>Cancel this session</Button></div>:null}
 {action==='FINALIZE'||action==='CANCEL'?<FinalizeSessionSheet key={action} session={{...session,counts:roster.data?.counts??session.counts}} cancel={action==='CANCEL'} assisting={assisting} busy={blocked} error={commands.error} onClose={()=>setAction(null)} onConfirm={value=>void commands.submit(action,{expectedLifecycleRevision:session.lifecycleRevision,...(action==='FINALIZE'?{expectedSnapshotRevision:session.snapshotRevision}:{}),...(value?{reason:value}:{})})}/>:null}
 {action==='POLICY'?<SessionPolicySheet session={session} busy={blocked} error={commands.error} onClose={()=>setAction(null)} onSave={payload=>void commands.submit('POLICY',payload)}/>:null}
 {edit?(edit.status==='EXCUSED'?<ExcuseSheet key={edit.member.studentId+edit.status} member={edit.member} requiresReason={edit.member.attendance.status!=='UNMARKED'||session.state==='FINALIZED'} busy={blocked} error={commands.error} onClose={()=>setEdit(null)} onSave={saveEdit}/>:<AttendanceCorrectionSheet key={edit.member.studentId+edit.status} member={edit.member} status={edit.status} requiresReason busy={blocked} error={commands.error} onClose={()=>setEdit(null)} onSave={saveEdit}/>):null}
 {ineligible?<IneligibleStudentSheet choice={ineligible} busy={blocked} error={commands.error} onClose={()=>setIneligible(null)} onSave={payload=>void commands.submit('ADJUSTMENT',{sessionId,...payload})}/>:null}
 {enrollment?<SessionEnrollmentSheet member={enrollment} session={session} busy={blocked} error={commands.error} onClose={()=>setEnrollment(null)} onSave={payload=>void commands.submit('ADJUSTMENT',{sessionId,...payload})}/>:null}
 </>:<div role="alert"><p>Attendance could not load.</p><Button className="min-h-12" onClick={()=>void query.refetch()}>Retry session</Button></div>}</div>;
}
