import Link from 'next/link';
import type { ClassroomReport } from '../../types/report';
import { registerMeetingHeadings } from '../../utils/reportRegister';

export default function ClassroomReportMeetings({meetings,termId,gradingPeriodId}: {meetings: ClassroomReport['meetings'];termId?:string;gradingPeriodId?:string}) {
 const headings=registerMeetingHeadings(meetings).reverse();
 if(!headings.length)return <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">No finalized meetings in this selection.</p>;
 return <ul className="divide-y rounded-xl border border-slate-200 bg-white">
  {headings.map(meeting=><li key={meeting.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
   <Link href={'/class/reports?'+new URLSearchParams({sessionId:meeting.id,classId:meeting.classId,...(termId?{termId}:{}),...(gradingPeriodId?{gradingPeriodId}:{})})} className="inline-flex min-h-10 items-center font-medium text-indigo-700 underline">
    {meeting.date}{meeting.time?' · '+meeting.time:null}{meeting.occurrence?' · Meeting '+meeting.occurrence:null}
   </Link>
   <span className="text-sm text-slate-600">{meeting.counts.present} Present · {meeting.counts.late} Late · {meeting.counts.absent} Absent · {meeting.counts.excused} Excused</span>
  </li>)}
 </ul>;
}
