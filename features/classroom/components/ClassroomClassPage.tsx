'use client';
import Link from 'next/link';
import { useAuth } from '@/globals/contexts/AuthContext';
import PageHeader from '@/globals/components/shared/PageHeader';
import { Button } from '@/globals/components/shad-cn/button';
import { useClassroomClass } from '../hooks/useClassroomClass';
import ClassForm from './ClassForm';
import RosterEditor from './RosterEditor';
import ClassOwnerEditor from './ClassOwnerEditor';
import ClassSessionHistory from './ClassSessionHistory';
export default function ClassroomClassPage({classId,mode='view',admin=false}:{classId:string;mode?:'view'|'settings'|'roster';admin?:boolean}){
 const {user}=useAuth();const administrator=user?.role==='ADMIN';const query=useClassroomClass(classId);const basePath=admin?'/class/admin/classes':'/class/classes';const item=query.data;
 return <div className="mx-auto min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-6 [&_h1]:break-words"><Link className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline" href={basePath}>← {admin?'Classroom classes':'My Classes'}</Link>
 {query.isLoading?<p>Loading class…</p>:query.isError?<div role="alert"><p>Class unavailable. Check your class list or connection.</p><Button className="min-h-12" onClick={()=>void query.refetch()}>Retry class</Button></div>:item?<><PageHeader eyebrow={mode==='roster'?'Manage roster':mode==='settings'?'Class settings':'Class'} title={item.displayName} description={item.subject.title+' · '+item.term.name}/>
 {mode==='settings'?<ClassForm key={item.id} initial={item} basePath={basePath}/>:mode==='roster'?<RosterEditor key={item.id} initial={item}/>:<><section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="font-semibold">Class configuration</h2><p>{item.sections.map(section=>section.name).join(' + ')||'Individual student roster'}</p><p className="text-sm text-slate-600">Teacher: {item.primaryTeacher.name}</p><p className="text-sm">Late grace period: {item.graceMinutes} minutes · Asia/Manila</p>{item.schedule?<p className="text-sm">Scheduled start: {item.schedule.startTime}{item.schedule.room?' · '+item.schedule.room:''}</p>:null}{item.archivedAt?<p className="text-sm text-amber-800">Archived. Past attendance remains available.</p>:null}<div className="flex flex-wrap gap-3">{user&&!administrator&&!item.archivedAt?<Link href={'/class/classes/'+encodeURIComponent(item.id)+'/start'} className="inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Start attendance</Link>:null}<Link href={basePath+'/'+encodeURIComponent(item.id)+'/roster'} className="inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Manage roster</Link><Link href={basePath+'/'+encodeURIComponent(item.id)+'/settings'} className="inline-flex min-h-12 items-center rounded-xl border px-4 text-sm font-semibold">Class settings</Link></div></section><ClassSessionHistory classId={classId}/></>}
 {admin?<ClassOwnerEditor key={item.id+'-'+item.configRevision} item={item} onSaved={()=>void query.refetch()}/>:null}
 </>:null}</div>;
}
