import type { ClassSummary } from './class';
import type { SessionHistoryItem } from './attendance';
export type OverviewClassSnapshot={v:1;id:string;displayName:string;primaryTeacher:{id:string;name:string};term:{id:string;name:string};subject:{id:string;code:string|null;title:string};sections:Array<{sectionId:string;name:string;slug:string}>};
export type OverviewMeeting=SessionHistoryItem&{classSnapshot:OverviewClassSnapshot;href:string};
export type OverviewPreview<T>={items:T[];total:number;limit:number;hasMore:boolean;href:string};
export type ClassroomOverview={serverNow:string;timeZone:'Asia/Manila';termId:string|null;stats:{classCount:number;activeMeetingCount:number;meetingsTodayCount:number};activeMeetings:OverviewPreview<OverviewMeeting>;recentClasses:OverviewPreview<ClassSummary>;recentMeetings:OverviewPreview<OverviewMeeting>};
