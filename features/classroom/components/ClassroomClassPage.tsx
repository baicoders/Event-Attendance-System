'use client';
import { BookOpen } from 'lucide-react';
import { Play } from 'lucide-react';
import { RefreshCw, Users, Pencil, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/globals/components/shad-cn/dropdown-menu';
import { useClassroomClass, useClassRoster } from '../hooks/useClassroomClass';
import { classroomReadRetry } from '../hooks/useClassroomSession';
import { ClassroomPage, SectionPanel, StatusBadge, Feedback, LoadingState } from './ui';
import ClassForm from './ClassForm';
import RosterEditor from './RosterEditor';
import ClassOwnerEditor from './ClassOwnerEditor';
import ClassSessionHistory from './ClassSessionHistory';

export function ClassAttendanceAction({classId,administrator,archived,loading,failed,activeSessionId,onRetry}:{classId:string;administrator:boolean;archived:boolean;loading:boolean;failed:boolean;activeSessionId:string|null;onRetry?:()=>void}) {
 if(activeSessionId)return <Button asChild className="min-h-12"><Link href={'/class/sessions/'+encodeURIComponent(activeSessionId)}><Play aria-hidden className="size-4"/>{administrator?'View session':'Resume attendance'}</Link></Button>;
 if(administrator||archived)return null;
 if(loading)return <Button disabled className="min-h-12">Checking attendance…</Button>;
 if(failed)return <Button variant="outline" className="min-h-12" onClick={onRetry}><RefreshCw aria-hidden className="size-4 shrink-0"/>Retry attendance status</Button>;
 return <Button asChild className="min-h-12"><Link href={'/class/classes/'+encodeURIComponent(classId)+'/start'}><Play aria-hidden className="size-4"/>Start attendance</Link></Button>;
}
const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export default function ClassroomClassPage({classId,mode='view',admin=false}:{classId:string;mode?:'view'|'settings'|'roster';admin?:boolean}) {
 const {user}=useAuth();const administrator=user?.role==='ADMIN';const query=useClassroomClass(classId);const basePath=admin?'/class/admin/classes':'/class/classes';const item=query.data;
 // Filter ACTIVE server-side so a backdated active meeting is found regardless of history pagination.
 const active=useQuery({queryKey:['classroom','meetings',user?.id,classId,'active'],enabled:!!user&&!!item,queryFn:({signal})=>fetchApi<{items:Array<{id:string}>}>('/api/classroom/classes/'+encodeURIComponent(classId)+'/sessions?state=ACTIVE&pageSize=1',{signal}),retry:classroomReadRetry,staleTime:0});
 const roster=useClassRoster(classId);
 const href=basePath+'/'+encodeURIComponent(classId);
 if(query.isLoading)return <ClassroomPage title="Class"><LoadingState label="Loading class…"/></ClassroomPage>;
 if(query.isError||!item)return <ClassroomPage title="Class unavailable"><Feedback title="Unable to load this class" onRetry={()=>void query.refetch()}>Check your class list or connection.</Feedback><Button asChild variant="outline"><Link href={basePath}>Back to classes</Link></Button></ClassroomPage>;
 return <ClassroomPage title={item.displayName} eyebrow={item.sections.map(section=>section.name).join(' + ')||'Individual student roster'} description={item.subject.title+' · '+item.term.name+' · '+item.primaryTeacher.name} breadcrumbs={[{label:admin?'Class administration':'My Classes',href:basePath},{label:item.displayName}]} actions={<><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="min-h-12">Class options<ChevronDown className="size-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild className="min-h-12"><Link href={href+'/roster'}><Users aria-hidden className="size-4 shrink-0"/>Manage roster</Link></DropdownMenuItem><DropdownMenuItem asChild className="min-h-12"><Link href={href+'/settings'}><Pencil aria-hidden className="size-4 shrink-0"/>Class settings</Link></DropdownMenuItem><DropdownMenuItem asChild className="min-h-12"><Link href={'/class/reports?'+new URLSearchParams({termId:item.termId,classId:item.id})}><BarChart3 aria-hidden className="size-4 shrink-0"/>Attendance reports</Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu><ClassAttendanceAction classId={classId} administrator={administrator} archived={!!item.archivedAt} loading={active.isPending||active.isFetching} failed={active.isError} activeSessionId={active.data?.items[0]?.id??null} onRetry={()=>void active.refetch()}/></>}>
 <nav aria-label="Class sections" className="flex gap-6 border-b border-slate-200">{([{value:'view',label:'Overview',suffix:''},{value:'roster',label:'Roster',suffix:'/roster'},{value:'settings',label:'Settings',suffix:'/settings'}] as const).map(tab=><Link key={tab.value} aria-current={mode===tab.value?'page':undefined} className={'flex min-h-12 items-center border-b-2 text-sm font-medium '+(mode===tab.value?'border-indigo-600 text-indigo-700':'border-transparent text-slate-600 hover:text-indigo-700')} href={href+tab.suffix}>{tab.label}</Link>)}</nav>
 {mode==='settings'?<><ClassForm key={item.id} initial={item} basePath={basePath}/>{admin?<ClassOwnerEditor key={item.id+'-'+item.configRevision} item={item} onSaved={()=>void query.refetch()}/>:null}</>:mode==='roster'?<RosterEditor key={item.id} initial={item}/>:<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]"><div className="min-w-0 space-y-6"><SectionPanel title="Class at a glance" icon={BookOpen} actions={<StatusBadge tone={item.archivedAt?'warning':'success'}>{item.archivedAt?'Archived':'Active class'}</StatusBadge>}><dl className="grid gap-6 text-sm sm:grid-cols-2">{[['Sections',item.sections.map(section=>section.name).join(' + ')||'Individual students'],['Teacher',item.primaryTeacher.name],['Schedule',item.schedule?item.schedule.days.map(day=>weekdays[day-1]).join(' / ')+' · '+item.schedule.startTime:'No weekly schedule'],['Room',item.schedule?.room||'Not set'],['Late grace period',item.graceMinutes+' minutes'],['Time zone','Asia/Manila']].map(([label,value])=><div key={label}><dt className="mb-1 text-xs text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value}</dd></div>)}</dl></SectionPanel><ClassSessionHistory classId={classId}/></div><div className="space-y-6"><SectionPanel title="Roster overview" icon={Users}>{roster.isPending?<LoadingState label="Loading roster count…"/>:roster.isError?<Feedback title="Roster count unavailable" onRetry={()=>void roster.refetch()}/>:<p className="text-4xl font-semibold tracking-tight text-slate-900">{roster.data.total}<span className="ml-2 text-sm font-normal text-slate-500">students</span></p>}<p className="mt-3 text-sm leading-6 text-slate-600">{item.sections.length} official {item.sections.length===1?'section':'sections'}, plus your saved additions and exclusions.</p><Button asChild variant="outline" className="mt-5 min-h-12 w-full"><Link href={href+'/roster'}>Manage roster<ArrowRight className="size-4"/></Link></Button></SectionPanel><Feedback tone="info" title="Future meetings use your saved settings">Roster and class changes apply to future meetings. Existing meetings keep their saved student snapshot.</Feedback></div></div>}
 </ClassroomPage>;
}
