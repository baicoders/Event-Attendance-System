'use client';
import { Plus, Play } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import FormInput from '@/globals/components/shared/FormInput';
import { Checkbox } from '@/globals/components/shad-cn/checkbox';
import { Button } from '@/globals/components/shad-cn/button';
import type { ClassList } from '../types/class';
import { useClassroomListState } from '../hooks/useClassroomListState';
import { useClassroomTermPreference } from '../hooks/useClassroomTermPreference';
import { classroomReadRetry } from '../hooks/useClassroomSession';
import { ClassroomPage, FilterToolbar, ClassroomSelect, LoadingState, Feedback, EmptyState, ListPagination } from './ui';
import ClassCard from './ClassCard';
export default function ClassDashboard({admin=false,attendanceOnly=false,teacherId}:{admin?:boolean;attendanceOnly?:boolean;teacherId?:string}){
 const {user}=useAuth();const administrator=user?.role==='ADMIN';const basePath=admin?'/class/admin/classes':'/class/classes';
 const {values,setValues,ready}=useClassroomListState({q:'',termId:'',archived:'false',page:'1',view:'active'});const page=Math.max(1,Number(values.page)||1);
 const {terms,chooseTerm}=useClassroomTermPreference(ready,id=>setValues({termId:id,page:'1'}));
 const active=values.view!=='start'&&values.view!=='ready';
 const classes=useQuery({queryKey:['classroom','classes',user?.id,user?.role,user?.classroomStatus,'list',values,teacherId,attendanceOnly,admin],enabled:ready&&!!user,queryFn:({signal})=>fetchApi<ClassList>('/api/classroom/classes?'+new URLSearchParams({q:values.q.trim(),...(values.termId?{termId:values.termId}:{}),...(admin&&teacherId?{teacherId}:{}),includeArchived:String(!attendanceOnly&&values.archived==='true'),...(attendanceOnly?{attendanceState:active?'ACTIVE':'READY'}:{}),page:String(page),pageSize:'20'}),{signal}),retry:classroomReadRetry,staleTime:0});
 const title=attendanceOnly?'Attendance':admin?'Classroom classes':'My Classes';
 const viewLink=(view:string)=>{const p=new URLSearchParams(values);p.set('view',view);p.delete('page');return '/class/attendance?'+p;};
 return <ClassroomPage title={title} eyebrow={admin?'Class administration':'Classroom'} description={attendanceOnly?'Resume a meeting in progress or choose a class for a new meeting.':administrator?'Review classes, sessions and saved rosters.':'Manage your subjects, saved rosters and class schedules.'} actions={!attendanceOnly?<Button asChild><Link href={basePath+'/new'}><Plus aria-hidden className="size-4 shrink-0"/>Create class</Link></Button>:null}>
 {attendanceOnly?<nav aria-label="Attendance views" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"><Button asChild variant={active?'default':'ghost'}><Link href={viewLink('active')} aria-current={active?'page':undefined}>Active meetings</Link></Button><Button asChild variant={!active?'default':'ghost'}><Link href={viewLink('start')} aria-current={!active?'page':undefined}><Play aria-hidden className="size-4 shrink-0"/>{administrator?'Classes ready for a meeting':'Start a meeting'}</Link></Button></nav>:null}
 <FilterToolbar resultCount={classes.data?.total} onReset={values.q||values.termId||values.archived==='true'?()=>setValues({q:'',termId:'',archived:'false',page:'1'}):undefined}><div className="w-full sm:max-w-sm"><FormInput label="Find a class" type="search" value={values.q} maxLength={100} onChange={event=>setValues({q:event.target.value,page:'1'})}/></div><div className="w-full sm:max-w-xs"><ClassroomSelect label="Term filter" value={values.termId} onValueChange={chooseTerm} options={[{value:'',label:'All terms'},...(terms.data?.items.map(term=>({value:term.id,label:term.name}))??[])]}/></div>{!attendanceOnly?<label className="flex min-h-12 cursor-pointer items-center gap-3 text-sm"><Checkbox checked={values.archived==='true'} onCheckedChange={checked=>setValues({archived:String(checked===true),page:'1'})}/>Include archived classes</label>:null}</FilterToolbar>
 {terms.isError?<Feedback title="Academic terms are unavailable" tone="warning" onRetry={()=>void terms.refetch()}>You can still review classes across all terms.</Feedback>:null}
 {!ready||classes.isLoading?<LoadingState label="Loading classes…"/>:classes.isError&&!classes.data?<Feedback title="Unable to load classes" onRetry={()=>void classes.refetch()}>Check your connection and retry.</Feedback>:<>{classes.isError?<Feedback title="Class refresh failed" tone="warning" onRetry={()=>void classes.refetch()}>Showing the last confirmed list.</Feedback>:null}{classes.data?.items.length?<><div className="grid min-w-0 gap-4 lg:grid-cols-2">{classes.data.items.map(item=><ClassCard key={item.id} item={item} basePath={basePath} showTeacher={admin||administrator} viewerRole={user?.role}/>)}</div><ListPagination page={page} pageSize={20} total={classes.data.total} onPageChange={next=>setValues({page:String(next)})} isPending={classes.isFetching}/></>:<EmptyState title={attendanceOnly?active?'No active meetings':'No classes ready in this view':'No classes in this view'} description={attendanceOnly?active?'Start a meeting when your class begins. Your confirmed attendance remains saved.':'Classes with an active meeting appear in Active meetings. Try another term or search.':'Try another search or term, or create a class and review its saved roster.'} actions={!attendanceOnly?<Button asChild><Link href={basePath+'/new'}><Plus aria-hidden className="size-4 shrink-0"/>Create class</Link></Button>:null}/>}</>}
 </ClassroomPage>;
}
