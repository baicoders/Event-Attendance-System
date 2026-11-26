'use client';
import HelpButton from './help/HelpButton';
import { RefreshCw } from 'lucide-react';
import { useEffect,useLayoutEffect,useRef } from 'react';
import { Button } from '@/globals/components/shad-cn/button';
import { Checkbox } from '@/globals/components/shad-cn/checkbox';
import { ClassroomSelect, SectionPanel } from './ui';
import FormInput from '@/globals/components/shared/FormInput';
import { attendanceLabels,type SessionRosterPage,type SessionMember,type AttendanceStatus,type FinalAttendanceStatus } from '../types/attendance';
import type { CommandDescriptor } from '../utils/scanCoordinator';
import StudentAttendanceCard from './StudentAttendanceCard';
export default function ManualRoster({data,loading,settling,error,onRetry,q,onSearch,status,onFilter,page,onPage,pending,rowErrors,onRetrySave,disabled,shortcutsEnabled=false,onMark,onEnrollment,includeExcluded,onIncludeExcluded,anchorRegister}:{data?:SessionRosterPage;loading:boolean;settling:boolean;error:boolean;onRetry:()=>void;q:string;onSearch:(value:string)=>void;status:AttendanceStatus|'';onFilter:(value:AttendanceStatus|'')=>void;page:number;onPage:(value:number)=>void;pending:CommandDescriptor[];rowErrors:Record<string,string>;onRetrySave:(commandId:string)=>void;disabled:boolean;shortcutsEnabled?:boolean;onMark:(member:SessionMember,status:FinalAttendanceStatus)=>void;onEnrollment:(member:SessionMember)=>void;includeExcluded:boolean;onIncludeExcluded:(value:boolean)=>void;anchorRegister:{current:(()=>void)|null}}){
 const container=useRef<HTMLDivElement>(null);const anchor=useRef<{scroll:number;rows:Array<{id:string;top:number}>}|null>(null);
 // Keep one pre-save anchor through pending UI, cached confirmation and the
 // authoritative refetch. A teacher's own scroll gesture cancels restoration.
 useEffect(()=>{
  anchorRegister.current=()=>{if(anchor.current)return;const rows=Array.from(container.current?.querySelectorAll<HTMLElement>('[data-roster-student]')??[]).map(row=>({id:row.dataset.rosterStudent!,top:row.getBoundingClientRect().top})).filter(row=>row.top>=-100);anchor.current={scroll:window.scrollY,rows};};
  const clear=()=>{anchor.current=null;};const key=(event:KeyboardEvent)=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))clear();};
  window.addEventListener('wheel',clear,{passive:true});window.addEventListener('touchmove',clear,{passive:true});window.addEventListener('keydown',key);
  return()=>{anchorRegister.current=null;window.removeEventListener('wheel',clear);window.removeEventListener('touchmove',clear);window.removeEventListener('keydown',key);};
 },[anchorRegister]);
 useLayoutEffect(()=>{anchor.current=null;},[q,status,page,includeExcluded]);
 useLayoutEffect(()=>{const saved=anchor.current;if(!saved)return;if(Math.abs(window.scrollY-saved.scroll)>80){anchor.current=null;return;}for(const row of saved.rows){const element=Array.from(container.current?.querySelectorAll<HTMLElement>('[data-roster-student]')??[]).find(item=>item.dataset.rosterStudent===row.id);if(element){window.scrollBy(0,element.getBoundingClientRect().top-row.top);saved.scroll=window.scrollY;break;}}if(!settling)anchor.current=null;},[data,settling,pending]);
 return <section className="min-w-0 space-y-4 [overflow-anchor:none]" aria-label="Manual attendance"><HelpButton topic="manual"/><SectionPanel contentClassName="space-y-3 p-4 sm:p-4"><FormInput label="Search this session" value={q} className="min-h-12" maxLength={100} onChange={event=>onSearch(event.target.value)}/><ClassroomSelect label="Attendance filter" value={status} onValueChange={value=>onFilter(value as AttendanceStatus|'')} options={[{value:'',label:'All results'},...Object.entries(attendanceLabels).map(([value,label])=>({value,label}))]}/><label className="flex min-h-12 items-center gap-3 text-sm"><Checkbox className="size-5" checked={includeExcluded} onCheckedChange={checked=>onIncludeExcluded(checked===true)}/>Show excluded students</label><p className="text-sm text-slate-600">100 students per page. Unmarked students become Absent only when you finalize.</p>{shortcutsEnabled?<p className="text-sm text-slate-600">Focus a student’s attendance marks to use P, L, A or E.</p>:null}</SectionPanel>
 {error?<div role="alert"><p>Roster could not refresh. Check your connection before continuing.</p><Button className="min-h-12" onClick={onRetry}><RefreshCw aria-hidden className="size-4 shrink-0"/>Retry roster</Button></div>:null}{loading&&!data?<p role="status">Loading session roster…</p>:null}
 <div ref={container} className="space-y-3">{data?.items.map(member=><StudentAttendanceCard key={member.studentId} member={member} shortcutsEnabled={shortcutsEnabled} disabled={disabled||error} pending={pending.some(entry=>entry.payload.studentId===member.studentId)} unconfirmed={pending.some(entry=>entry.payload.studentId===member.studentId&&entry.state==='UNCONFIRMED')} error={rowErrors[member.studentId]} onRetry={()=>{const entry=pending.find(value=>value.payload.studentId===member.studentId);if(entry)onRetrySave(entry.commandId);}} onMark={value=>onMark(member,value)} onEnrollment={()=>onEnrollment(member)}/>)}</div>
 {data&&!data.items.length?<p className="rounded-xl border bg-white p-4">No students in this view. Adjust the search or filter.</p>:null}
 {data?<nav aria-label="Session roster pages" className="flex flex-wrap items-center gap-3"><Button className="min-h-12" variant="outline" disabled={page<=1} onClick={()=>onPage(page-1)}>Previous</Button><span className="text-sm">Page {page} of {data.pageCount} · {data.filteredCount} students</span><Button className="min-h-12" variant="outline" disabled={page>=data.pageCount} onClick={()=>onPage(page+1)}>Next</Button></nav>:null}
 </section>;
}
