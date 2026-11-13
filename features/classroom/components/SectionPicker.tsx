'use client';
import { useEffect,useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import type { SectionOption } from '../types/class';
export default function SectionPicker({selected,onChange,disabled=false,initialLabels=[]}:{selected:string[];onChange:(ids:string[])=>void;disabled?:boolean;initialLabels?:Array<{id:string;name:string}>}){
 const [search,setSearch]=useState('');const [q,setQ]=useState('');const [page,setPage]=useState(1);const names=useRef(new Map(initialLabels.map(row=>[row.id,row.name])));
 useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
 const sections=useQuery({queryKey:['classroom','sections',q,page],queryFn:({signal})=>fetchApi<{items:SectionOption[];total:number}>('/api/classroom/sections?'+new URLSearchParams({q,page:String(page),pageSize:'100'}),{signal})});
 useEffect(()=>{for(const row of sections.data?.items??[])names.current.set(row.id,row.name);},[sections.data]);
 return <section className="min-w-0 space-y-3"><h2 className="font-semibold">Select official sections</h2><p className="text-sm text-slate-600">Choose one or combine several sections. Their students are included automatically; review irregular additions and exclusions in the saved roster.</p><FormInput label="Find sections" className="min-h-12" value={search} maxLength={100} disabled={disabled} onChange={event=>setSearch(event.target.value)}/>
 {selected.length?<div className="flex flex-wrap gap-2" aria-label="Selected sections">{selected.map(id=><span key={id} className="max-w-full break-words rounded-full bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{sections.data?.items.find(row=>row.id===id)?.name||names.current.get(id)||'Selected section'}</span>)}</div>:<p className="text-sm text-slate-600">No section selected yet.</p>}
 {sections.isLoading?<p>Loading sections…</p>:sections.isError?<p role="alert">Unable to load sections. <button type="button" className="min-h-12 text-sm font-semibold underline" onClick={()=>void sections.refetch()}>Retry</button></p>:!sections.data?.items.length?<p>No matching official sections. Check the name, or add existing students individually in your class roster.</p>:<ul className="space-y-2">{sections.data.items.map(section=><li key={section.id}><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><input type="checkbox" className="size-5 shrink-0 accent-indigo-600" aria-label={section.name} checked={selected.includes(section.id)} disabled={disabled} onChange={event=>onChange(event.target.checked?[...selected,section.id]:selected.filter(id=>id!==section.id))}/><span className="min-w-0 flex-1 break-words">{section.name}</span><span className="text-xs text-slate-500">{section.studentCount} students</span></label></li>)}</ul>}
 {sections.data&&sections.data.total>100?<div className="flex gap-3"><Button className="min-h-12" variant="outline" disabled={disabled||page===1} onClick={()=>setPage(value=>value-1)}>Previous sections</Button><Button className="min-h-12" variant="outline" disabled={disabled||page*100>=sections.data.total} onClick={()=>setPage(value=>value+1)}>More sections</Button></div>:null}
 </section>;
}
