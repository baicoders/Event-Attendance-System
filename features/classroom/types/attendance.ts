import type { RosterMember,ClassDetails } from './class';
export type AttendanceStudentDisplay={id:string;firstName:string;middleName:string|null;lastName:string;usn:string|null;lrn:string|null};
export type AttendanceStatus='UNMARKED'|'PRESENT'|'LATE'|'ABSENT'|'EXCUSED';
export type FinalAttendanceStatus=Exclude<AttendanceStatus,'UNMARKED'>;
export type AttendanceCounts=Record<AttendanceStatus,number>;
export type AttendanceRecord={sessionId:string;studentId:string;status:AttendanceStatus;revision:number;excuseNote:string|null;markedAt:string|null;method:string|null};
export type SessionMember={sessionId:string;studentId:string;studentSnapshot:RosterMember['studentSnapshot'];originSnapshot:RosterMember['originSnapshot'];included:boolean;membershipRevision:number;attendance:AttendanceRecord};
export type ClassroomSession={id:string;classId:string;state:'ACTIVE'|'FINALIZED'|'CANCELED';scheduledStartAt:string;startedAt:string;lateAfter:string;graceMinutes:number;timeZone:string;lifecycleRevision:number;snapshotRevision:number;counts:AttendanceCounts;currentPrimaryTeacherId:string;showFirstAttendanceGuidance?:boolean;classSnapshot:{id:string;displayName:string;primaryTeacher:{id:string;name:string};term:{id:string;name:string};subject:{title:string}}};
export type SessionRosterPage={sessionId:string;state:ClassroomSession['state'];lifecycleRevision:number;snapshotRevision:number;items:SessionMember[];counts:AttendanceCounts;total:number;filteredCount:number;page:number;pageSize:number;pageCount:number;excludedCount:number};
export type StartPreview={class:ClassDetails;configRevision:number;rosterRevision:number;rosterFingerprint:string;rosterCount:number;serverNow:string;suggestedStartAt:string;activeSessionId:string|null};
export const attendanceLabels:Record<AttendanceStatus,string>={UNMARKED:'Unmarked',PRESENT:'Present',LATE:'Late',ABSENT:'Absent',EXCUSED:'Excused'};

export type MeetingCounts={counts:AttendanceCounts;rosterCount:number;markedCount:number};
export type SessionHistoryItem=MeetingCounts&{id:string;classId:string;state:ClassroomSession['state'];scheduledStartAt:string;startedAt:string;finalizedAt:string|null;canceledAt:string|null;lifecycleRevision:number;snapshotRevision:number};
export type SessionHistoryPage={items:SessionHistoryItem[];total:number;page:number;pageSize:number};
