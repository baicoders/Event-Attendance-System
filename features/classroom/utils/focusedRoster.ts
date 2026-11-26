import type { AttendanceRecord, SessionMember } from '../types/attendance';

/** A page-one working buffer. Only the current card is pinned across reads. */
export function reconcileFocusedRoster(current:SessionMember[],incoming:SessionMember[],confirmed:ReadonlyMap<string,number>):SessionMember[]{
 const usable=(member:SessionMember)=>member.included&&member.attendance.status==='UNMARKED'&&!confirmed.has(member.studentId);
 const first=current[0];const authoritative=first&&incoming.find(member=>member.studentId===first.studentId);
 const head=first&&(authoritative&&authoritative.attendance.revision>=first.attendance.revision?authoritative:first);
 const rows:SessionMember[]=head&&usable(head)?[head]:[];const ids=new Set(rows.map(member=>member.studentId));
 for(const member of incoming)if(usable(member)&&!ids.has(member.studentId)){rows.push(member);ids.add(member.studentId);}
 return rows;
}
export function confirmFocusedStudent(current:SessionMember[],confirmed:Map<string,number>,record:AttendanceRecord){
 if(record.status==='UNMARKED')return current;
 confirmed.set(record.studentId,Math.max(confirmed.get(record.studentId)??0,record.revision));
 return current.filter(member=>member.studentId!==record.studentId);
}
