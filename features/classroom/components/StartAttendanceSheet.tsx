'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError,fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import type { ClassroomSession,StartPreview } from '../types/attendance';
import { manilaDateTimeInput,manilaInputInstant } from '../utils/manualRosterState';
import { useClassroomAttendance } from '../hooks/useClassroomAttendance';
import { classroomReadRetry } from '../hooks/useClassroomSession';
import AttendanceActionSheet from './AttendanceActionSheet';
import PendingAttendanceCommands from './PendingAttendanceCommands';
function TeacherStartAttendanceSheet({classId,onClose}:{classId:string;onClose:()=>void}){
 const {user}=useAuth();const router=useRouter();const [start,setStart]=useState('');const [reason,setReason]=useState('');const [localError,setLocalError]=useState('');const [existing,setExisting]=useState<string|null>(null);
 const preview=useQuery({queryKey:['classroom','start-preview',user?.id,classId],queryFn:({signal})=>fetchApi<StartPreview>('/api/classroom/classes/'+encodeURIComponent(classId)+'/start-preview',{signal}),retry:classroomReadRetry,staleTime:0});
 const commands=useClassroomAttendance('CLASS',classId,{onConfirmed:(_,value)=>router.push('/class/sessions/'+encodeURIComponent((value as ClassroomSession).id)),onProblem:(_,error)=>{if(error instanceof ApiError&&error.code==='ACTIVE_SESSION_EXISTS'&&typeof error.details?.sessionId==='string')setExisting(error.details.sessionId);}});
 const data=preview.data;const busy=!commands.ready||commands.pending.length>0;const active=existing??data?.activeSessionId;const adminAssistance=!!data&&data.class.primaryTeacherId!==user?.id;
 function begin(){if(!data||!commands.ready)return;try{const scheduledStartAt=manilaInputInstant(start||manilaDateTimeInput(data.suggestedStartAt));setLocalError('');void commands.submit('START',{scheduledStartAt,expectedConfigRevision:data.configRevision,expectedRosterRevision:data.rosterRevision,expectedRosterFingerprint:data.rosterFingerprint,...(reason.trim()?{reason:reason.trim()}:{})});}catch(error){setLocalError(error instanceof Error?error.message:'Review the meeting time.');}}
 return <AttendanceActionSheet open title="Start attendance" description="Review this meeting. Opening this page creates no attendance or absences." onClose={onClose}>
 {preview.isLoading?<p role="status">Preparing the saved class roster…</p>:preview.isError?<div role="alert"><p>Unable to prepare this class. Check your connection or return to My Classes.</p><Button className="min-h-12" onClick={()=>void preview.refetch()}>Retry preview</Button></div>:data?<><h2 className="break-words font-semibold">{data.class.displayName}</h2><p>{data.rosterCount} eligible students · {data.class.graceMinutes} minute grace</p><p className="break-words text-sm">{data.class.sections.map(section=>section.name).join(' + ')||'Individual student roster'}. Saved additions and exclusions are included automatically.</p>{active?<Link className="flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white" href={'/class/sessions/'+encodeURIComponent(active)}>Continue active session</Link>:<><FormInput label="Meeting start (Asia/Manila)" type="datetime-local" className="min-h-12" value={start||manilaDateTimeInput(data.suggestedStartAt)} onChange={event=>setStart(event.target.value)} disabled={busy}/><p className="text-sm text-slate-600">This time determines lateness. After the grace period a scan is Late. Starting now creates an Unmarked roster; finalizing turns remaining Unmarked students into Absent.</p>{start&&manilaDateTimeInput(data.serverNow).slice(0,10)!==start.slice(0,10)?<p className="text-sm text-amber-800">You selected a different meeting date. Review it before starting historical attendance.</p>:null}{adminAssistance?<FormInput label="Reason for assisting this teacher" minLength={3} maxLength={1000} value={reason} className="min-h-12" onChange={event=>setReason(event.target.value)} disabled={busy}/>:null}<Button className="min-h-12 w-full" disabled={busy||!data.rosterCount||!!data.class.archivedAt||(adminAssistance&&reason.trim().length<3)} onClick={begin}>Start attendance</Button>{!data.rosterCount?<Link href={'/class/classes/'+encodeURIComponent(classId)+'/roster'} className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline">Add students to the saved roster first</Link>:null}</>}</>:null}
 <PendingAttendanceCommands items={commands.pending} onRetry={id=>void commands.retry(id)}/>{commands.error||localError?<p role="alert" className="break-words text-sm text-rose-800">{localError||commands.error}</p>:null}{!busy&&commands.error?<Button className="min-h-12 w-full" variant="outline" onClick={()=>void preview.refetch()}>Reload current preview</Button>:null}
 </AttendanceActionSheet>;
}

export default function StartAttendanceSheet(props:{classId:string;onClose:()=>void}) {
 const {user,isLoading}=useAuth();
 if(isLoading||!user)return <p role="status" className="p-6">Checking attendance access…</p>;
 if(user.role==='ADMIN')return <AttendanceActionSheet open title="Attendance is started by the teacher" description="Administrators can view sessions and assist with corrections from the class history." onClose={props.onClose}><Button asChild variant="outline"><Link href={'/class/admin/classes/'+encodeURIComponent(props.classId)}>Open class</Link></Button></AttendanceActionSheet>;
 return <TeacherStartAttendanceSheet {...props}/>;
}
