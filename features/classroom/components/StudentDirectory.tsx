'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import type { DirectoryResponse } from '../types/student';
export default function StudentDirectory(){
 const [search,setSearch]=useState('');const [q,setQ]=useState('');const [page,setPage]=useState(1);
 useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
 const directory=useQuery({queryKey:['classroom','students',q,page],queryFn:({signal})=>fetchApi<DirectoryResponse>('/api/classroom/students?'+new URLSearchParams({q,page:String(page),pageSize:'100'}),{signal}),staleTime:0});
 return <div className="space-y-5"><p className="text-sm text-slate-600">Shared official student directory. Correct an existing profile or verify its current information. Class attendance stays private to its teacher.</p>
 <FormInput label="Search students" className="min-h-12" placeholder="Name, USN or LRN" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)} />
 {directory.isLoading?<p role="status">Loading students…</p>:directory.isError?<div role="alert"><p>Unable to load students. Check your connection.</p><Button className="min-h-12" onClick={()=>void directory.refetch()}>Retry</Button></div>:!directory.data?.items.length?<p>No matching students. Check the name or identifier. Student imports are handled by an administrator.</p>:<>
 <p className="text-sm text-slate-600">{directory.data.total} students · 100 per page</p><ul className="space-y-3">{directory.data.items.map(student=><li key={student.id}><Link className="block min-h-12 space-y-1 rounded-2xl border border-slate-200 bg-white p-4 focus-visible:ring-2 focus-visible:ring-indigo-500" href={'/class/students/'+encodeURIComponent(student.id)}><p className="break-words font-semibold">{student.lastName}, {student.firstName} {student.middleName}</p><p className="break-words text-sm text-slate-600">{student.usn||student.lrn||'No printed identifier'} · {student.groups.filter(g=>g.category==='SECTION').map(g=>g.name).join(', ')||'No official section'}</p><span className="text-sm text-indigo-700">{student.verification.state==='VERIFIED'?'Verified':student.verification.state==='NEEDS_CORRECTION'?'Needs correction':'Unverified'}</span></Link></li>)}</ul>
 {directory.data.total>100?<nav aria-label="Student pages" className="flex items-center gap-3"><Button className="min-h-12" variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page}</span><Button className="min-h-12" variant="outline" disabled={page*100>=directory.data.total} onClick={()=>setPage(p=>p+1)}>Next</Button></nav>:null}</>}
 </div>;
}
