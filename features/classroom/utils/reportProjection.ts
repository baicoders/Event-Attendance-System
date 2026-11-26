import type { ClassroomReport,ClassroomReportSnapshot,ClassroomReportEntry,ClassroomReportRow,ReportCounts } from '../types/report';
/** Reporting convention v1. Late is attended; Excused is outside the denominator. */
export function attendanceRateCounts(input:Pick<ReportCounts,'present'|'late'|'absent'|'excused'>):ReportCounts{
 const attended=input.present+input.late;const denominator=attended+input.absent;const rate=denominator?Math.round(attended*1000/denominator)/10:null;
 return {...input,attended,eligibleMeetings:denominator+input.excused,numerator:attended,denominator,rate,rateText:rate===null?'N/A':rate.toFixed(1)+'%'};
}
const empty=()=>({present:0,late:0,absent:0,excused:0});
function countEntries(entries:ClassroomReportEntry[]){const counts=empty();for(const row of entries)counts[row.status.toLowerCase() as keyof typeof counts]++;return attendanceRateCounts(counts);}
export function buildClassroomReport(snapshot:ClassroomReportSnapshot):ClassroomReport{
 const sessions=[...snapshot.sessions].sort((a,b)=>a.scheduledStartAt.localeCompare(b.scheduledStartAt)||a.id.localeCompare(b.id));const entries:ClassroomReportEntry[]=[];const meetings:ClassroomReport['meetings']=[];const grouped=new Map<string,{row:ClassroomReportRow;counts:ReturnType<typeof empty>}>();const excludedSessions={active:0,canceled:0};
 for(const session of sessions){
  if(session.state!=='FINALIZED'){excludedSessions[session.state==='ACTIVE'?'active':'canceled']++;continue;}
  const selected:ClassroomReportEntry[]=[];
  for(const member of session.members){
   if(!member.included)continue;
   if(!member.attendance||member.attendance.status==='UNMARKED')throw new Error('Incomplete finalized attendance snapshot.');
   const entry:ClassroomReportEntry={sessionId:session.id,classId:session.classId,className:session.classSnapshot.displayName,subject:session.classSnapshot.subject.title,termName:session.classSnapshot.term.name,scheduledStartAt:session.scheduledStartAt,studentId:member.studentId,identity:{...member.studentSnapshot},status:member.attendance.status};selected.push(entry);entries.push(entry);
   let group=grouped.get(entry.studentId);if(!group){group={row:{studentId:entry.studentId,identity:entry.identity,identityAsOf:session.scheduledStartAt,counts:attendanceRateCounts(empty())},counts:empty()};grouped.set(entry.studentId,group);}
   group.row.identity=entry.identity;group.row.identityAsOf=entry.scheduledStartAt;group.counts[entry.status.toLowerCase() as keyof typeof group.counts]++;
  }
  if(snapshot.filters.studentId&&!selected.length)continue;
  meetings.push({id:session.id,classId:session.classId,className:session.classSnapshot.displayName,subject:session.classSnapshot.subject.title,scheduledStartAt:session.scheduledStartAt,counts:countEntries(selected)});
 }
 const rows=[...grouped.values()].map(({row,counts})=>({...row,counts:attendanceRateCounts(counts)})).sort((a,b)=>a.identity.lastName.localeCompare(b.identity.lastName)||a.identity.firstName.localeCompare(b.identity.firstName)||a.studentId.localeCompare(b.studentId));
 return {filters:{...snapshot.filters},evaluatedAt:snapshot.evaluatedAt,reportVersion:snapshot.reportVersion,timeZone:'Asia/Manila',policyVersion:'CLASSROOM_RATE_V1',policy:'Attendance rate = (Present + Late) / (Present + Late + Absent). Excused is shown separately and excluded. Zero denominator = N/A. This is a system reporting convention, not an official school policy.',totals:countEntries(entries),rows,entries,meetings,excludedSessions};
}
export function attendanceAtMeeting(report:ClassroomReport,studentId:string,sessionId:string){return report.entries.find(row=>row.studentId===studentId&&row.sessionId===sessionId)?.status??'NOT_ENROLLED';}
