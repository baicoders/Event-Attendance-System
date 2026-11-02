'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { Button } from '@/globals/components/shad-cn/button';
import PageHeader from '@/globals/components/shared/PageHeader';
import { useClassroomReports,reportSearchParams } from '../../hooks/useClassroomReports';
import type { ClassroomReportFilters as Filters } from '../../types/report';
import ClassroomReportFilters from './ClassroomReportFilters';
import ClassroomReportSummary from './ClassroomReportSummary';
import ClassroomReportRows from './ClassroomReportRows';
export default function ClassroomReportsPage({initial={}}:{initial?:Filters}){
 const {refresh}=useAuth();const [selection,setSelection]=useState<Filters|null>(initial.termId||initial.sessionId?initial:null);const [page,setPage]=useState(1);const query=useClassroomReports(selection,page);const [error,setError]=useState('');const [downloading,setDownloading]=useState(false);const [blocked,setBlocked]=useState(false);const report=blocked?undefined:query.data;
 const total=report?(report.filters.studentId?report.totalEntries:report.totalRows):0;const pages=Math.max(1,Math.ceil(total/100));
 async function download(format:'SUMMARY'|'DETAIL'){
  if(!report)return;setDownloading(true);setError('');
  try{const params=reportSearchParams(report.filters);params.set('expectedReportVersion',report.reportVersion);params.set('format',format);const response=await fetch('/api/classroom/reports/export?'+params.toString(),{cache:'no-store'});
   if(!response.ok){if([401,403,404].includes(response.status)){setBlocked(true);void refresh();}let message='Export failed. Check your connection and refresh the report.';try{const problem=await response.json();if(typeof problem.message==='string')message=problem.message;}catch{}throw new Error(message);}
   if(!response.headers.get('content-type')?.startsWith('text/csv')||response.headers.get('x-report-version')!==report.reportVersion)throw new Error('Export could not be confirmed for this report. Refresh before retrying.');
   const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='classroom-'+format.toLowerCase()+'-'+report.reportVersion.slice(0,12)+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(cause){setError(cause instanceof Error?cause.message:'Export failed.');}finally{setDownloading(false);}
 }
 const printParams=report?reportSearchParams(report.filters):null;if(printParams&&report)printParams.set('expectedReportVersion',report.reportVersion);
 return <div className="mx-auto min-w-0 max-w-4xl space-y-5 px-4 py-6 sm:px-6"><PageHeader eyebrow="Class" title="Attendance reports" description="Finalized attendance from historical session rosters. Shared student identity never grants access to another teacher’s classes."/><ClassroomReportFilters initial={initial} busy={query.isFetching} onApply={filters=>{setSelection(filters);setPage(1);setBlocked(false);setError('');const url=new URL(window.location.href);url.search=reportSearchParams(filters).toString();window.history.replaceState(null,'',url);}}/>
 {!selection?<p className="rounded-xl border bg-white p-4">Choose a class and term, day, session or student to prepare a report.</p>:query.isLoading?<p role="status">Preparing historical attendance…</p>:query.isError||blocked?<div role="alert" className="space-y-3"><p>{query.error instanceof Error?query.error.message:'This report is unavailable under your current access.'}</p><Button className="min-h-12" onClick={()=>{setBlocked(false);setError('');void query.refetch();}}>Refresh report</Button></div>:report?<><ClassroomReportSummary report={report}/><div className="flex flex-wrap gap-2"><Button className="min-h-12" variant="outline" onClick={()=>{setError('');void query.refetch();}}>Refresh report</Button><Button className="min-h-12" disabled={downloading} onClick={()=>void download('SUMMARY')}>Download summary CSV</Button><Button className="min-h-12" variant="outline" disabled={downloading} onClick={()=>void download('DETAIL')}>Download meeting-detail CSV</Button><Link className="inline-flex min-h-12 items-center rounded-xl border bg-white px-4 font-semibold text-indigo-700" href={'/class/reports/print?'+printParams} target="_blank" rel="noopener noreferrer">Printable report</Link></div><p className="text-sm text-slate-600">CSV includes the full bounded selection, regardless of the displayed page. Numeric identifiers use a spreadsheet text prefix to preserve leading zeroes. Excuse notes are omitted.</p><ClassroomReportRows report={report}/>{pages>1?<nav aria-label="Report pages" className="flex flex-wrap items-center gap-3"><Button className="min-h-12" variant="outline" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</Button><span>Page {page} of {pages} · {total} {report.filters.studentId?'eligible meeting entries':'students'}</span><Button className="min-h-12" variant="outline" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>Next</Button></nav>:null}</>:null}
 {error?<p role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>:null}</div>;
}
