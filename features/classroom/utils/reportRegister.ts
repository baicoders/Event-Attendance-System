import { formatReportDateTime } from "@/globals/utils/reportTime";
import type { ClassroomReport } from "../types/report";
import type { ClassroomReportEntry, ClassroomReportRow, RegisterMark } from '../types/report';

export const REGISTER_MEETINGS_PER_PAGE = 12;

export function buildRegisterMarks(
 entries: ClassroomReportEntry[],
 rows: ClassroomReportRow[],
 meetingIds: string[],
): RegisterMark[][] {
 const students = new Map(rows.map((row, index) => [row.studentId, index]));
 const columns = new Map(meetingIds.map((id, index) => [id, index]));
 const marks = rows.map(() => meetingIds.map((): RegisterMark => 'NOT_ENROLLED'));
 for (const entry of entries) {
  const row = students.get(entry.studentId);
  const column = columns.get(entry.sessionId);
  if (row !== undefined && column !== undefined) marks[row][column] = entry.status;
 }
 return marks;
}

export const registerMarkLabels = {
 PRESENT: ['P', 'Present'], LATE: ['L', 'Late'], ABSENT: ['A', 'Absent'],
 EXCUSED: ['E', 'Excused'], NOT_ENROLLED: ['—', 'Not eligible'],
} as const;

export function orderRegisterRows(rows: ClassroomReportRow[]) {
 // The report projection already sorts the source rows by historical name.
 return [...rows].sort((a, b) => b.counts.attended - a.counts.attended);
}

export function registerIdentifier(identity: ClassroomReportRow['identity']) {
 return identity.usn ?? (identity.lrn ? 'LRN '+identity.lrn : '—');
}

export function registerStudentName(identity: ClassroomReportRow['identity']) {
 return identity.lastName+', '+[identity.firstName,identity.middleName].filter(Boolean).join(' ');
}

export function registerMeetingHeadings(meetings: ClassroomReport['meetings']) {
 const timestamps = meetings.map(meeting=>formatReportDateTime(meeting.scheduledStartAt));
 const dates = new Map<string,number>();
 const times = new Map<string,number>();
 for(const stamp of timestamps) {
  const date=stamp.slice(0,10);
  dates.set(date,(dates.get(date)??0)+1);
  times.set(stamp,(times.get(stamp)??0)+1);
 }
 const seen = new Map<string,number>();
 return meetings.map((meeting,index)=>{
  const stamp=timestamps[index];
  const date=stamp.slice(0,10);
  const ordinal=(seen.get(stamp)??0)+1;
  seen.set(stamp,ordinal);
  return {...meeting,date,day:date.slice(5),year:date.slice(0,4),
   time:(dates.get(date)??0)>1?stamp.slice(11):'',
   occurrence:(times.get(stamp)??0)>1?ordinal:null};
 });
}

export function registerYearGroups(meetings: ReturnType<typeof registerMeetingHeadings>) {
 const groups: Array<{year: string; start: number; count: number}> = [];
 for(const [index,meeting] of meetings.entries()){
  const group=groups.at(-1);
  if(group?.year===meeting.year)group.count++;
  else groups.push({year:meeting.year,start:index,count:1});
 }
 return groups;
}

export function registerHeader(report: Pick<ClassroomReport,'registerMetadata'|'filters'|'gradingPeriod'|'meetings'|'evaluatedAt'>, studentCount:number) {
 const metadata=report.registerMetadata;
 const month = (date?:string) => date ? new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z')) : '';
 return {
  school:'ACLC COLLEGE OF ORMOC, INC.',
  title:'ATTENDANCE REPORT OF STUDENTS',
  term:metadata?.term??'',
  fields:[
   ['SUBJECT',metadata?.subject??''],['SECTION',metadata?.sections.join(' / ')??''],['COURSE',metadata?.course??''],
   ['TERM',report.gradingPeriod?.name??(report.filters.from||report.filters.to?'Custom dates':'Full term')],
   ['TOTAL STUDENTS',studentCount],
   ['STARTING MONTH',month(report.gradingPeriod?.startDate??report.filters.from??formatReportDateTime(report.meetings[0]?.scheduledStartAt??null).slice(0,10))],
   ['END MONTH',month(report.gradingPeriod?.endDate??report.filters.to??formatReportDateTime(report.meetings.at(-1)?.scheduledStartAt??null).slice(0,10))],
  ] as const,
  instructor:metadata?.instructor??'',
  dateSubmitted:formatReportDateTime(report.evaluatedAt).slice(0,10),
 };
}
