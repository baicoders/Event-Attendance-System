import { serializeCsv } from '@/globals/utils/csvExport';
import { formatReportDateTime } from '@/globals/utils/reportTime';
import { attendanceRateCounts } from './reportProjection';
import type { ClassroomReport,ReportCounts } from '../types/report';
/** CSV text convention: prefix numeric identifiers with an apostrophe for spreadsheets. */
const identifier=(value:string|null)=>value&&/^\d/.test(value)?"'"+value:value??'';
const countColumns=['Present','Late','Absent','Excused','Attended','Eligible meetings','Numerator','Denominator','Rate'];
const counts=(value:ReportCounts)=>({'Present':value.present,'Late':value.late,'Absent':value.absent,'Excused':value.excused,'Attended':value.attended,'Eligible meetings':value.eligibleMeetings,'Numerator':value.numerator,'Denominator':value.denominator,'Rate':value.rateText});
export function buildClassroomCsv(report:ClassroomReport,format:'SUMMARY'|'DETAIL'='SUMMARY'){
 const common=['Report version','Prepared (Asia/Manila)','Student ID','USN','LRN','Student'];
 const metadata={'Report version':report.reportVersion,'Prepared (Asia/Manila)':formatReportDateTime(report.evaluatedAt)};
 const identity=(row:ClassroomReport['rows'][number]['identity'])=>({'Student ID':identifier(row.id),'USN':identifier(row.usn),'LRN':identifier(row.lrn),'Student':[row.firstName,row.middleName,row.lastName].filter(Boolean).join(' ')});
 if(format==='SUMMARY')return '\uFEFF'+serializeCsv([...common,'Identity as of (Asia/Manila)',...countColumns],report.rows.map(row=>({...metadata,...identity(row.identity),'Identity as of (Asia/Manila)':formatReportDateTime(row.identityAsOf),...counts(row.counts)})));
 return '\uFEFF'+serializeCsv([...common,'Meeting ID','Meeting start (Asia/Manila)','Class ID','Class','Subject','Term','Status',...countColumns],report.entries.map(row=>({...metadata,...identity(row.identity),'Meeting ID':row.sessionId,'Meeting start (Asia/Manila)':formatReportDateTime(row.scheduledStartAt),'Class ID':row.classId,'Class':row.className,'Subject':row.subject,'Term':row.termName,'Status':row.status,...counts(attendanceRateCounts({present:Number(row.status==='PRESENT'),late:Number(row.status==='LATE'),absent:Number(row.status==='ABSENT'),excused:Number(row.status==='EXCUSED')}))})));
}
