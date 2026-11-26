import { attendanceLabels,type AttendanceRecord } from '../types/attendance';
export function mergeConfirmedAttendance(current:AttendanceRecord,incoming:AttendanceRecord){return current.sessionId===incoming.sessionId&&current.studentId===incoming.studentId&&incoming.revision>current.revision?incoming:current;}
export function clampRosterPage(page:number,total:number){return Math.max(1,Math.min(page,Math.ceil(total/100)||1));}
export function manilaDateTimeInput(instant:string){return new Date(Date.parse(instant)+8*3600000).toISOString().slice(0,16);}
export function manilaInputInstant(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+':00+08:00')))throw new Error('Choose a valid meeting date and time.');return value+':00+08:00';}
export function formatManila(instant:string){return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(instant));}

export function attendanceConfirmation(current:AttendanceRecord|undefined,incoming:AttendanceRecord,outcome:string|undefined,name:string){
 if(current&&current.studentId===incoming.studentId&&current.sessionId===incoming.sessionId&&current.revision>incoming.revision)return 'Earlier save confirmed — '+name+'. Current result remains '+attendanceLabels[current.status]+'.';
 return outcome==='ALREADY_RECORDED'||outcome==='ALREADY_MARKED'?'Already marked '+attendanceLabels[incoming.status]+' — '+name+'. Existing attendance kept.':'Confirmed: '+attendanceLabels[incoming.status]+' — '+name+'.';
}
