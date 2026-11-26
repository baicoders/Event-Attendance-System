import { SectionPanel } from '../ui';
import { formatReportDateTime } from '@/globals/utils/reportTime';
import type { ClassroomReport } from '../../types/report';

export default function ClassroomReportSummary({report}:{report:Pick<ClassroomReport,'totals'|'meetings'|'filters'|'evaluatedAt'|'reportVersion'|'policy'|'excludedSessions'>}) {
 const t=report.totals;
 const metrics=[
  {label:'Attendance rate',value:t.rateText,detail:'Present + Late, excluding Excused'},
  {label:'Meetings held',value:report.meetings.length,detail:report.filters.studentId?'Eligible finalized meetings':'Finalized meetings in this report'},
  {label:'Attended',value:t.attended,detail:`${t.present} Present · ${t.late} Late`},
  {label:'Absences',value:t.absent,detail:`${t.excused} Excused, shown separately`},
 ];
 return <section aria-label="Report totals" data-report-version={report.reportVersion} className="space-y-4">
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map(metric=><SectionPanel key={metric.label} contentClassName="space-y-0 p-4 sm:p-4"><p className="text-sm font-medium text-slate-600">{metric.label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{metric.value}</p><p className="mt-1 text-xs text-slate-500">{metric.detail}</p></SectionPanel>)}</div>
  <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm print:hidden"><summary className="min-h-12 cursor-pointer content-center font-medium text-slate-700">How this report is calculated</summary><div className="mt-3 space-y-2 text-slate-600">
   <p>{report.policy}</p><p>Numerator: {t.numerator} attended. Denominator: {t.denominator} Present + Late + Absent. There are {t.eligibleMeetings} eligible student-meetings, including {t.excused} Excused. Meetings held counts distinct finalized meetings, so two meetings on the same date count separately.</p>
   <p>Eligibility and names come from each meeting’s frozen roster. A student’s displayed identity comes from their latest included meeting. Later enrollment or directory edits cannot create historical absences. Student reports count only meetings where that student was eligible.</p>
   <p>Excluded meetings: {report.excludedSessions.active} active · {report.excludedSessions.canceled} canceled. Excuse notes remain private. Student table search and pagination leave report totals, charts, print and exports unchanged.</p>
   <p>CSV exports include all students in the report. Numeric identifiers receive a spreadsheet text prefix to preserve leading zeroes; spreadsheet formulas are escaped.</p>
   <p className="break-words text-xs">Prepared {formatReportDateTime(report.evaluatedAt)} · Asia/Manila. Version {report.reportVersion}. Printing and exporting check this version; refresh after attendance changes.</p>
  </div></details>
 </section>;
}
