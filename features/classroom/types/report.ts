import type { AttendanceStatus,FinalAttendanceStatus } from './attendance';
import type { GradingPeriod } from './class';
export type ClassroomReportFilters={termId?:string;classId?:string;gradingPeriodId?:string;sessionId?:string;studentId?:string;from?:string;to?:string};
export type ClassroomReportSelection = ClassroomReportFilters & { view?: 'class' };
export type ReportIdentity={id:string;firstName:string;lastName:string;middleName:string|null;usn:string|null;lrn:string|null};
export type ReportSnapshotSession={id:string;classId:string;state:'ACTIVE'|'FINALIZED'|'CANCELED';scheduledStartAt:string;lifecycleRevision:number;snapshotRevision:number;classSnapshot:{displayName:string;term:{id:string;name:string};subject:{title:string};sections?:Array<{name:string}>;primaryTeacher?:{name:string}};members:Array<{studentId:string;included:boolean;membershipRevision:number;studentSnapshot:ReportIdentity;attendance:{status:AttendanceStatus;revision:number}|null}>};
export type ClassroomReportSnapshot={filters:ClassroomReportFilters;registerMetadata?:RegisterMetadata;gradingPeriod?:GradingPeriod;evaluatedAt:string;reportVersion:string;sessions:ReportSnapshotSession[]};
export type ReportCounts={present:number;late:number;absent:number;excused:number;attended:number;eligibleMeetings:number;numerator:number;denominator:number;rate:number|null;rateText:string};
export type ClassroomReportEntry={sessionId:string;classId:string;className:string;subject:string;termName:string;scheduledStartAt:string;studentId:string;identity:ReportIdentity;status:FinalAttendanceStatus};
export type ClassroomReportRow={studentId:string;identity:ReportIdentity;identityAsOf:string;counts:ReportCounts};
export type ClassroomReport={filters:ClassroomReportFilters;registerMetadata?:RegisterMetadata;gradingPeriod?:GradingPeriod;evaluatedAt:string;reportVersion:string;timeZone:'Asia/Manila';policyVersion:'CLASSROOM_RATE_V1';policy:string;totals:ReportCounts;rows:ClassroomReportRow[];entries:ClassroomReportEntry[];meetings:Array<{id:string;classId:string;className:string;subject:string;scheduledStartAt:string;counts:ReportCounts}>;excludedSessions:{active:number;canceled:number}};
export type RegisterMark = FinalAttendanceStatus | 'NOT_ENROLLED';
export type RegisterPage = {
 meetingIds: string[];
 rowNumbers: number[];
 marks: RegisterMark[][];
 meetingPage: number;
 pageCount: number;
};
export type ClassroomReportPage=Omit<ClassroomReport,'rows'|'entries'>&{rows:ClassroomReportRow[];entries:ClassroomReportEntry[];register?:RegisterPage;totalRows:number;totalStudents:number;totalEntries:number;page:number;pageSize:number};

export type RegisterMetadata = {
 subject: string;
 sections: string[];
 term: string;
 instructor: string;
 course: string;
};
