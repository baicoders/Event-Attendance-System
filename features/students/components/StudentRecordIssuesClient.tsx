'use client';
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useAuth} from '@/globals/contexts/AuthContext';
import {useFetchStudents} from '@/globals/hooks/useStudents';
import {getStudentDataIssues,isEmployeeRecord,matchesStudentIssueSearch,STUDENT_ISSUE_LABELS,type StudentIssueCode} from '../issues/dataIssues';
import StudentDataIssueBadges from './StudentDataIssueBadges';

const selectClass='mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';
function AuthorizedIssues() {
 const query=useFetchStudents();
 const params=useSearchParams();
 const [page,setPage]=useState(0);
 const entries=useMemo(()=>(query.data??[]).filter(student=>!isEmployeeRecord(student)).map(student=>({student,issues:getStudentDataIssues(student)})),[query.data]);
 const groups=(category:string)=>[...new Map(entries.flatMap(({student})=>(student.groups??[]).filter(group=>group.category===category).map(group=>[group.slug,group.name]))).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 const summary={total:entries.length,complete:entries.filter(entry=>entry.issues.length===0).length,attention:entries.filter(entry=>entry.issues.length>0).length,house:entries.filter(entry=>entry.issues.includes('MISSING_HOUSE')).length,other:entries.filter(entry=>entry.issues.some(code=>code!=='MISSING_HOUSE')).length};
 const filtered=entries.filter(({student,issues})=>{
  const q=(params.get('q')??'').trim().toLowerCase();
  if(!matchesStudentIssueSearch(student,q))return false;
  const level=params.get('schoolLevel');if(level&&(level==='missing'?!!student.schoolLevel:student.schoolLevel!==level))return false;
  const issue=params.get('issue');if(issue&&!issues.includes(issue as StudentIssueCode))return false;
  if(params.get('house')==='missing'&&!issues.includes('MISSING_HOUSE'))return false;
  const identifier=params.get('missingIdentifier');
  if(identifier==='usn'&&student.usn||identifier==='lrn'&&student.lrn||identifier==='both'&&(student.usn||student.lrn))return false;
  const status=params.get('recordStatus');if(status==='complete'&&issues.length||status==='attention'&&!issues.length)return false;
  if(params.get('yearLevel')&&student.yearLevel!==params.get('yearLevel'))return false;
  for(const [field,category] of [['program','PROGRAM'],['section','SECTION']] as const)if(params.get(field)&&!student.groups?.some(group=>group.category===category&&group.slug===params.get(field)))return false;
  return true;
 }).sort((a,b)=>a.student.lastName.localeCompare(b.student.lastName)||a.student.firstName.localeCompare(b.student.firstName)||a.student.id.localeCompare(b.student.id));
 const pages=Math.max(1,Math.ceil(filtered.length/25));const current=Math.min(page,pages-1);
 const returnTo=`/students/issues${params.size?`?${params}`:''}`;
 const levelOptions=[['SHS','Senior High School'],['COLLEGE','College'],['missing','Not provided']] as const;
 const select=(name:string,label:string,options:ReadonlyArray<readonly [string,string]>)=><label className="text-sm font-medium">{label}<select name={name} defaultValue={params.get(name)??''} className={selectClass}><option value="">All</option>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>;
 if(query.isLoading)return <p role="status">Loading student records…</p>;
 if(query.isError)return <div role="alert">Could not load student records. <button className="underline" onClick={()=>void query.refetch()}>Retry</button></div>;
 return <div className="space-y-6">
  <div aria-label="Student record summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Total students',summary.total],['Complete records',summary.complete],['Needing attention',summary.attention],['Missing House',summary.house],['Other information gaps',summary.other]].map(([label,count])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="text-2xl font-semibold">{count}</p></div>)}</div>
  <form key={params.toString()} method="get" action="/students/issues" aria-label="Filter student record issues" className="grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm font-medium">Search name / USN / LRN<input name="q" defaultValue={params.get('q')??''} className={selectClass} /></label>
   {select('schoolLevel','School level',levelOptions)}
   {select('issue','Record issue',Object.entries(STUDENT_ISSUE_LABELS))}
   {select('house','House assignment',[['missing','Missing House']])}
   {select('missingIdentifier','Missing identifier',[['usn','No USN'],['lrn','No LRN'],['both','Neither identifier']])}
   {select('recordStatus','Completeness',[['attention','Needs attention'],['complete','Complete']])}
   {select('yearLevel','Year / Grade',[...new Set(entries.map(entry=>entry.student.yearLevel).filter((value):value is NonNullable<typeof value>=>!!value))].sort().map(value=>[value,value.replaceAll('_',' ')] as const))}
   {select('program','Program',groups('PROGRAM'))}
   {select('section','Section',groups('SECTION'))}
   <div className="flex items-end gap-3"><button type="submit" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Apply filters</button><Link href="/students/issues" onClick={()=>setPage(0)} className="py-2 text-sm underline">Reset</Link></div>
  </form>
  <p className="text-sm">{filtered.length} matching students. A missing identifier type can be legitimate. Either USN or LRN is sufficient for attendance.</p>
  <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Student</th><th className="p-3">USN</th><th className="p-3">LRN</th><th className="p-3">School / academics</th><th className="p-3">Record issues</th><th className="p-3">Action</th></tr></thead><tbody>{filtered.slice(current*25,(current+1)*25).map(({student})=><tr key={student.id} className="border-b align-top"><td className="p-3">{student.lastName}, {student.firstName} {student.middleName??''}</td><td className="p-3">{student.usn??'—'}</td><td className="p-3">{student.lrn??'—'}</td><td className="p-3">{[student.schoolLevel,student.yearLevel?.replaceAll('_',' '),...(student.groups??[]).map(group=>group.name)].filter(Boolean).join(' · ')||'Not provided'}</td><td className="min-w-48 p-3"><StudentDataIssueBadges student={student}/></td><td className="p-3"><Link className="whitespace-nowrap text-indigo-700 underline" href={`/students/${encodeURIComponent(student.id)}?returnTo=${encodeURIComponent(returnTo)}`}>Edit record</Link></td></tr>)}</tbody></table>{!filtered.length&&<p className="p-4">No students match these filters.</p>}</div>
  <div className="flex items-center gap-4"><button className="rounded-full border bg-white px-4 py-2 disabled:opacity-40" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span className="text-sm">Page {current+1} of {pages}</span><button className="rounded-full border bg-white px-4 py-2 disabled:opacity-40" disabled={current+1===pages} onClick={()=>setPage(current+1)}>Next</button></div>
 </div>;
}
export default function StudentRecordIssuesClient() {
 const {user,isLoading}=useAuth();
 if(isLoading)return <p role="status">Checking access…</p>;
 if(!user||user.role!=='ADMIN'||user.status!=='ACTIVE'||user.mustChangePassword)return <p role="alert">An active administrator account is required.</p>;
 return <AuthorizedIssues key={user.id}/>;
}
