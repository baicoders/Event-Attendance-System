'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import PageHeader from '@/globals/components/shared/PageHeader';
import type { DirectoryStudent } from '../types/student';
import StudentCorrectionSheet from './StudentCorrectionSheet';
import VerificationPanel from './VerificationPanel';
import StudentChangeTimeline from './StudentChangeTimeline';
export default function ClassroomStudentDetail({studentId}:{studentId:string}){
 const [editing,setEditing]=useState(false);const client=useQueryClient();const student=useQuery({queryKey:['classroom','student',studentId],queryFn:()=>fetchApi<DirectoryStudent>('/api/classroom/students/'+encodeURIComponent(studentId)),staleTime:0});
 const saved=()=>{setEditing(false);void student.refetch();void client.invalidateQueries({queryKey:['classroom','student-history',studentId]});void client.invalidateQueries({queryKey:['classroom','students']});void client.invalidateQueries({queryKey:['classroom','classes']});void client.invalidateQueries({queryKey:['classroom','roster']});};
 return <div className="mx-auto min-w-0 max-w-6xl space-y-6 px-4 py-6 sm:px-6 [&_h1]:break-words"><Link href="/class/students" className="flex min-h-12 items-center text-indigo-700 underline">← Shared student directory</Link>{student.isLoading?<p>Loading student…</p>:student.isError?<div role="alert"><p>Student unavailable. Check your access or connection.</p><Button className="min-h-12" onClick={()=>void student.refetch()}>Retry</Button></div>:student.data?<><PageHeader eyebrow="Official student record" title={student.data.lastName+', '+student.data.firstName}/><div className="space-y-2 rounded-2xl border bg-white p-5"><p className="break-words">USN: {student.data.usn||'Not set'} · LRN: {student.data.lrn||'Not set'}</p><p>Official section: {student.data.groups.filter(g=>g.category==='SECTION').map(g=>g.name).join(', ')||'Not set'}</p><p className="text-sm text-slate-600">Record version {student.data.profileRevision}. No other teacher’s private attendance is shown here.</p><Button className="min-h-12" variant="outline" onClick={()=>setEditing(true)}>Correct information</Button></div><VerificationPanel key={student.data.editVersion} student={student.data} onSaved={saved}/><StudentChangeTimeline studentId={studentId}/>{editing?<StudentCorrectionSheet student={student.data} onClose={()=>setEditing(false)} onSaved={saved}/>:null}</>:null}</div>;
}
