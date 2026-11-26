import { formatReportDateTime } from '@/globals/utils/reportTime';
import type { ClassroomReport, ClassroomReportEntry } from '../../types/report';
import { attendanceLabels } from '../../types/attendance';
import { registerIdentifier, registerMeetingHeadings, registerStudentName } from '../../utils/reportRegister';

const meetingDateLabel=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});

export default function ClassroomRegisterPrint({report}: {report: ClassroomReport}) {
 const {filters,gradingPeriod,registerMetadata:metadata}=report;
 const from=gradingPeriod?.startDate??filters.from;
 const to=gradingPeriod?.endDate??filters.to;
 const range=from&&to?`${from} to ${to}`:from?`From ${from}`:to?`Through ${to}`:'Full term';
 const className=report.meetings[0]?.className||[metadata?.subject,...(metadata?.sections??[])].filter(Boolean).join(' · ');
 const headings=new Map(registerMeetingHeadings(report.meetings).map(heading=>[heading.id,heading]));
 const byStudent=new Map<string,ClassroomReportEntry[]>();
 for(const entry of report.entries){
  const existing=byStudent.get(entry.studentId);
  if(existing)existing.push(entry);
  else byStudent.set(entry.studentId,[entry]);
 }
 return <article className="mx-auto max-w-4xl space-y-5 p-4 text-slate-950 print:max-w-none print:p-0">
  <style>{'@page { size: A4 portrait; margin: 10mm; }'}</style>
  <header>
   <h1 className="text-xl font-semibold">Class attendance report</h1>
   {className?<p className="font-medium">{className}</p>:null}
   <p className="text-sm">{[metadata?.term,gradingPeriod?.name,range].filter(Boolean).join(' · ')}</p>
   <p className="mt-1 text-xs">{report.rows.length} students · {report.meetings.length} finalized meetings · Asia/Manila</p>
  </header>
  {report.rows.length?<section aria-labelledby="print-student-summary">
   <h2 id="print-student-summary" className="mb-2 font-semibold">Student summary</h2>
   <table aria-labelledby="print-student-summary" className="w-full border-collapse text-xs">
    <thead className="table-header-group border-y border-slate-400 text-left"><tr>
     {['Student','Present','Late','Absent','Excused','Rate'].map(label=><th key={label} scope="col" className="px-1 py-1">{label}</th>)}
    </tr></thead>
    <tbody>{report.rows.map(({studentId,identity,counts})=><tr key={studentId} className="break-inside-avoid border-b border-slate-200">
     <th scope="row" className="px-1 py-1 text-left font-medium">{registerStudentName(identity)}<span className="block text-[9px] font-normal">{registerIdentifier(identity)}</span></th>
     {[counts.present,counts.late,counts.absent,counts.excused,counts.rateText].map((value,index)=><td key={index} className="px-1 py-1">{value}</td>)}
    </tr>)}</tbody>
   </table>
  </section>:<p>No finalized eligible attendance in this selection.</p>}
  {report.rows.length?<section aria-labelledby="print-attendance-by-student" className="space-y-4">
   <div className="break-after-avoid">
    <h2 id="print-attendance-by-student" className="font-semibold">Attendance by student</h2>
    <p className="text-xs">Each row shows one finalized meeting where the student was on the roster.</p>
   </div>
   {report.rows.map(({studentId,identity})=><table key={studentId} aria-label={registerStudentName(identity)} className="w-full border-collapse text-xs">
    <thead className="table-header-group break-after-avoid">
     <tr><th colSpan={2} className="border-t border-slate-400 px-2 py-2 text-left">
      {registerStudentName(identity)} <span className="font-normal">· {registerIdentifier(identity)}</span>
     </th></tr>
     <tr className="border-y border-slate-300 bg-slate-50 text-left">
      <th scope="col" className="w-2/3 px-2 py-1">Meeting date</th>
      <th scope="col" className="px-2 py-1">Attendance</th>
     </tr>
    </thead>
    <tbody>{(byStudent.get(studentId)??[]).map(entry=>{
     const meeting=headings.get(entry.sessionId)!;
     const date=meetingDateLabel.format(new Date(meeting.date+'T00:00:00Z'));
     return <tr key={entry.sessionId} className="break-inside-avoid border-b border-slate-200">
      <td className="px-2 py-1">
       <time dateTime={meeting.time?meeting.scheduledStartAt:meeting.date}>{date}{meeting.time?' at '+meeting.time:null}</time>
       {meeting.occurrence?' · Meeting '+meeting.occurrence:null}
      </td>
      <td className="px-2 py-1 font-medium">{attendanceLabels[entry.status]}</td>
     </tr>;
    })}</tbody>
   </table>)}
  </section>:null}
  <footer className="text-xs">Prepared {formatReportDateTime(report.evaluatedAt)} · Asia/Manila</footer>
 </article>;
}
