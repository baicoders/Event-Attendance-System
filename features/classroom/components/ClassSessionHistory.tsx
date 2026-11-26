'use client';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useClassroomListState } from '../hooks/useClassroomListState';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { formatManila } from '../utils/manualRosterState';
import { classroomReadRetry } from '../hooks/useClassroomSession';
import type { SessionHistoryPage } from '../types/attendance';
import { SectionPanel, StatusBadge, Feedback, LoadingState } from './ui';
export default function ClassSessionHistory({classId}:{classId:string}) {
 const {user}=useAuth();const {values,setValues,ready}=useClassroomListState({meetingPage:'1'});const page=Math.max(1,Math.min(100000,Number.parseInt(values.meetingPage,10)||1));
 const meetings=useQuery({queryKey:['classroom','meetings',user?.id,classId,page],enabled:!!user&&ready,queryFn:({signal})=>fetchApi<SessionHistoryPage>('/api/classroom/classes/'+encodeURIComponent(classId)+'/sessions?pageSize=20&page='+page,{signal}),retry:classroomReadRetry});
 return <SectionPanel title="Meeting history" description="Open a meeting to review its saved attendance." contentClassName="p-0 sm:p-0" footer={meetings.data&&meetings.data.total>20?<nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Meeting pages"><span className="text-sm text-slate-500">Page {page} · {meetings.data.total} meetings</span><div className="flex gap-2"><Button variant="outline" className="min-h-12" disabled={page<=1} onClick={()=>setValues({meetingPage:String(page-1)})}>Previous</Button><Button variant="outline" className="min-h-12" disabled={page*20>=meetings.data.total} onClick={()=>setValues({meetingPage:String(page+1)})}>Next</Button></div></nav>:undefined}>
 {!ready||meetings.isLoading?<div className="p-5"><LoadingState label="Loading meetings…"/></div>:meetings.isError?<div className="p-5"><Feedback title="Unable to load meetings" onRetry={()=>void meetings.refetch()}/></div>:meetings.data?.items.length?<ul className="divide-y divide-slate-100">{meetings.data.items.map(item=><li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="min-w-0 basis-full sm:basis-0 sm:flex-1"><p className="text-sm font-medium text-slate-900">{formatManila(item.scheduledStartAt)}</p><p className="mt-1 text-xs text-slate-500">{item.state==='ACTIVE'?item.markedCount+' of '+item.rosterCount+' marked':item.state==='FINALIZED'?(item.counts.PRESENT+item.counts.LATE)+' attended · '+item.counts.ABSENT+' absent · '+item.counts.EXCUSED+' excused':'Canceled meeting · Asia/Manila'}</p></div><StatusBadge tone={item.state==='ACTIVE'?'success':item.state==='CANCELED'?'warning':'neutral'}>{item.state==='ACTIVE'?'Active':item.state==='FINALIZED'?'Finalized':'Canceled'}</StatusBadge><Button asChild variant="outline" className="min-h-12"><Link href={'/class/sessions/'+encodeURIComponent(item.id)}><Play aria-hidden className="size-4 shrink-0"/>{user?.role==='ADMIN'?'View session':item.state==='ACTIVE'?'Resume':'Review'}</Link></Button></li>)}</ul>:<p className="p-5 text-sm leading-6 text-slate-600">No meetings yet. Start attendance when class begins.</p>}
 </SectionPanel>;
}
