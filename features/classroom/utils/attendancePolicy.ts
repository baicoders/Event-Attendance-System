import { z } from 'zod';
import { AuthError } from '@/globals/utils/authError';
import type { ClassSchedule } from '../types/class';
export type AttendancePolicySnapshot={v:1;scheduledStartAt:string;timeZone:'Asia/Manila';graceMinutes:number;lateAfter:string};
const instant=z.iso.datetime({offset:true});
export function schoolDate(at:Date):string {
  if(!Number.isFinite(at.getTime()))throw new AuthError('Use a valid timestamp.',400,'INVALID_TIMESTAMP');
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
}
export function buildAttendancePolicy(scheduledStartAt:string,graceMinutes:number):AttendancePolicySnapshot {
  if(!instant.safeParse(scheduledStartAt).success||!Number.isFinite(Date.parse(scheduledStartAt)))throw new AuthError('Use an ISO timestamp with a timezone offset.',400,'INVALID_TIMESTAMP');
  if(!Number.isInteger(graceMinutes)||graceMinutes<0||graceMinutes>180)throw new AuthError('Grace period must be from 0 to 180 minutes.',400,'INVALID_GRACE_PERIOD');
  const start=new Date(scheduledStartAt);
  return {v:1,scheduledStartAt:start.toISOString(),timeZone:'Asia/Manila',graceMinutes,lateAfter:new Date(start.getTime()+graceMinutes*60000).toISOString()};
}
export function classifyClassroomArrival(policy:Pick<AttendancePolicySnapshot,'lateAfter'>,serverAt:Date):'PRESENT'|'LATE' {
  if(!Number.isFinite(serverAt.getTime()))throw new AuthError('Invalid server timestamp.',500,'INVALID_TIMESTAMP');
  return serverAt.getTime()<=new Date(policy.lateAfter).getTime()?'PRESENT':'LATE';
}
export function validateSessionStart(policy:AttendancePolicySnapshot,term:{startDate:string;endDate:string},serverNow:Date) {
  const day=schoolDate(new Date(policy.scheduledStartAt));
  if(day<term.startDate||day>term.endDate)throw new AuthError('Choose a meeting date inside this academic term.',400,'START_OUTSIDE_TERM');
  if(Date.parse(policy.scheduledStartAt)>serverNow.getTime()+5*60000)throw new AuthError('Start time cannot be more than five minutes ahead of server time.',400,'START_IN_FUTURE');
}
export function suggestClassroomStart(schedule:ClassSchedule|null,serverNow:Date):string {
  const day=schoolDate(serverNow);const localDay=new Date(day+'T00:00:00Z').getUTCDay()||7;
  return schedule?.days.includes(localDay)?new Date(day+'T'+schedule.startTime+':00+08:00').toISOString():serverNow.toISOString();
}

export function schoolDateRange(from?:string,to?:string){
  return {
    ...(from?{gte:new Date(from+'T00:00:00+08:00')}:{}),
    ...(to?{lt:new Date(Date.parse(to+'T00:00:00+08:00')+86400000)}:{}),
  };
}
