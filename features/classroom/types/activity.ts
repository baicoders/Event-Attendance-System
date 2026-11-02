export type ActivitySource='attendance'|'audit'|'profile'|'verification';
export type ClassroomActivity={source:ActivitySource;id:string;action:string;actorId:string|null;actorName:string;classId:string|null;sessionId:string|null;studentId:string|null;entityId:string|null;createdAt:string;reason:string|null;profileRevision?:number};
export type ActivityPage={items:ClassroomActivity[];nextCursor:string|null;globalStudentActivityIncluded:boolean;signals:Array<{studentId:string;count:number;kind:'ATTENDANCE_CORRECTIONS'|'PROFILE_CORRECTIONS'}>};
export type ActivityDetail=ClassroomActivity&{before:unknown;after:unknown;verificationCurrent?:boolean;currentProfileRevision?:number;privateNotesOmitted:true};
