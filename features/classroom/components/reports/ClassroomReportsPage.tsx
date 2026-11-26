'use client';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { ChevronDown,Download,Printer,RefreshCw,Search } from 'lucide-react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { Button } from '@/globals/components/shad-cn/button';
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuLabel,DropdownMenuItem } from '@/globals/components/shad-cn/dropdown-menu';
import { ClassroomPage, LoadingState, Feedback } from '../ui';
import { useClassroomReports,reportSearchParams } from '../../hooks/useClassroomReports';
import type { ClassroomReportFilters as Filters } from '../../types/report';
import ClassroomReportFilters from './ClassroomReportFilters';
import ClassroomReportSummary from './ClassroomReportSummary';
import ClassroomReportRows from './ClassroomReportRows';
import ClassroomReportCharts from './ClassroomReportCharts';
export default function ClassroomReportsPage({initial={}}:{initial?:Filters}) {
 const {refresh}=useAuth();const [selection,setSelection]=useState<Filters|null>(initial.termId||initial.sessionId?initial:null);const [page,setPage]=useState(1);const [search,setSearch]=useState('');const [q,setQ]=useState('');
 useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setPage(1);},250);return()=>clearTimeout(timer);},[search]);
 const query=useClassroomReports(selection,page,q);const [error,setError]=useState('');const [downloading,setDownloading]=useState(false);const [blocked,setBlocked]=useState(false);const report=blocked?undefined:query.data;
 const total=report?(report.filters.studentId?report.totalEntries:report.totalRows):0;const pages=Math.max(1,Math.ceil(total/100));
 async function download(format:'SUMMARY'|'DETAIL') {
  if(!report)return;setDownloading(true);setError('');
  try{const params=reportSearchParams(report.filters);params.set('expectedReportVersion',report.reportVersion);params.set('format',format);const response=await fetch('/api/classroom/reports/export?'+params.toString(),{cache:'no-store'});
   if(!response.ok){if([401,403,404].includes(response.status)){setBlocked(true);void refresh();}let message='Export failed. Check your connection and refresh the report.';try{const problem=await response.json();if(typeof problem.message==='string')message=problem.message;}catch{}throw new Error(message);}
   if(!response.headers.get('content-type')?.startsWith('text/csv')||response.headers.get('x-report-version')!==report.reportVersion)throw new Error('Export could not be confirmed for this report. Refresh before retrying.');
   const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='classroom-'+format.toLowerCase()+'-'+report.reportVersion.slice(0,12)+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(cause){setError(cause instanceof Error?cause.message:'Export failed.');}finally{setDownloading(false);}
 }
 const printParams=report?reportSearchParams(report.filters):null;if(printParams&&report)printParams.set('expectedReportVersion',report.reportVersion);
 return <ClassroomPage hero eyebrow="Classroom" title="Attendance reports" description="Review attendance across classes, students and meetings.">
  <ClassroomReportFilters initial={initial} busy={query.isFetching} onApply={filters=>{setSelection(filters);setPage(1);setSearch('');setQ('');setBlocked(false);setError('');const url=new URL(window.location.href);url.search=reportSearchParams(filters).toString();window.history.replaceState(null,'',url);}}/>
  {!selection?<p className="rounded-xl border bg-white p-5 text-sm text-slate-600">Choose a report view, term and class to prepare attendance.</p>:query.isLoading?<LoadingState label="Preparing attendance report…"/>:query.isError||blocked?<div role="alert" className="space-y-3"><p>{query.error instanceof Error?query.error.message:'This report is unavailable under your current access.'}</p><Button onClick={()=>{setBlocked(false);setError('');void query.refetch();}}><RefreshCw aria-hidden className="size-4 shrink-0"/>Refresh report</Button></div>:report?<>
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">{report.filters.studentId?'Student attendance':report.filters.sessionId?'Meeting attendance':report.filters.from&&report.filters.from===report.filters.to?'Daily attendance':'Class attendance'}</h2><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={()=>{setError('');void query.refetch();}}><RefreshCw className="size-4"/>Refresh report</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={downloading}><Download className="size-4"/>{downloading?'Exporting…':'Export'}<ChevronDown className="size-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>All students in report</DropdownMenuLabel><DropdownMenuItem onSelect={()=>void download('SUMMARY')}><BarChart3 aria-hidden className="size-4 shrink-0"/>Summary CSV</DropdownMenuItem><DropdownMenuItem onSelect={()=>void download('DETAIL')}><BarChart3 aria-hidden className="size-4 shrink-0"/>Meeting-detail CSV</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" asChild><Link href={'/class/reports/print?'+printParams} target="_blank" rel="noopener noreferrer"><Printer className="size-4"/>Print</Link></Button></div></div>
   <ClassroomReportSummary report={report}/><ClassroomReportCharts report={report}/>
   <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Students</h2><p className="mt-1 text-xs text-slate-500">{report.totalRows} {q?'matching students':'students'}{q?` of ${report.totalStudents}`:''} · P Present · L Late · A Absent · E Excused</p></div>{!report.filters.studentId?<label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search students in this report</span><Search aria-hidden className="absolute left-3 top-4 size-4 text-slate-400"/><input className="min-h-12 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm" type="search" value={search} maxLength={100} placeholder="Search name, USN or LRN" onChange={event=>setSearch(event.target.value)}/></label>:null}</div>
   <ClassroomReportRows report={report}/>{pages>1?<nav aria-label="Report pages" className="flex flex-wrap items-center justify-end gap-3 text-sm"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</Button><span>Page {page} of {pages} · {total} {report.filters.studentId?'eligible meetings':'students'}</span><Button variant="outline" size="sm" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>Next</Button></nav>:null}
  </>:null}
  {error?<Feedback title="Export unavailable">{error}</Feedback>:null}
 </ClassroomPage>;
}
