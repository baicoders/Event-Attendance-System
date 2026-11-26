import { createHash } from 'node:crypto';
import { verificationContentHash } from '@/features/students/server/verificationContent';
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0;
export type RosterStudent={id:string;usn:string|null;lrn:string|null;firstName:string;lastName:string;middleName:string|null;schoolLevel:string|null;yearLevel:string|null;profileRevision:number;archivedAt:Date|null;groups:Array<{id:string;slug:string;name:string;category:string}>};
export type RosterException={studentId:string;kind:'INCLUDE'|'EXCLUDE';reason:string};
export type RosterConfig={classId:string;rosterRevision:number;sectionIds:string[];exceptions:RosterException[]};
export type RosterMemberProjection={studentId:string;profileRevision:number;contentHash:string;studentSnapshot:{v:1;id:string;usn:string|null;lrn:string|null;firstName:string;lastName:string;middleName:string|null;schoolLevel:string|null;yearLevel:string|null;profileRevision:number;groups:RosterStudent['groups']};originSnapshot:{v:1;selectedSectionIds:string[];individualAddition:boolean;includeReason:string|null}};
/** Pure composition; official directory membership is never modified. */
export function composeRosterFromStudents(students:RosterStudent[],sectionIds:string[],exceptions:RosterException[]):RosterMemberProjection[]{
 const selected=new Set(sectionIds);const excluded=new Set(exceptions.filter(row=>row.kind==='EXCLUDE').map(row=>row.studentId));const included=new Map(exceptions.filter(row=>row.kind==='INCLUDE').map(row=>[row.studentId,row]));
 const deduplicated=new Map<string,RosterMemberProjection>();
 for(const student of students){
  if(student.archivedAt||student.groups.some(group=>group.slug==='employees')||excluded.has(student.id))continue;
  const sections=student.groups.filter(group=>group.category==='SECTION'&&selected.has(group.id)).map(group=>group.id).sort();const addition=included.get(student.id);
  if(!sections.length&&!addition)continue;
  const groups=student.groups.filter(group=>['SECTION','DEPARTMENT','PROGRAM','STRAND'].includes(group.category)).map(({id,slug,name,category})=>({id,slug,name,category})).sort((a,b)=>compareId(a.id,b.id));
  deduplicated.set(student.id,{studentId:student.id,profileRevision:student.profileRevision,contentHash:verificationContentHash(student),
   studentSnapshot:{v:1,id:student.id,usn:student.usn,lrn:student.lrn,firstName:student.firstName,lastName:student.lastName,middleName:student.middleName,schoolLevel:student.schoolLevel,yearLevel:student.yearLevel,profileRevision:student.profileRevision,groups},
   originSnapshot:{v:1,selectedSectionIds:sections,individualAddition:!!addition,includeReason:addition?.reason??null}});
 }
 return [...deduplicated.values()].sort((a,b)=>a.studentSnapshot.lastName.localeCompare(b.studentSnapshot.lastName)||a.studentSnapshot.firstName.localeCompare(b.studentSnapshot.firstName)||compareId(a.studentId,b.studentId));
}
/** Hash the complete eligibility set, never a searched/paginated UI subset. */
export function fingerprintClassRoster(roster:RosterMemberProjection[],config:RosterConfig){
 const projection={v:1,classId:config.classId,rosterRevision:config.rosterRevision,sectionIds:[...new Set(config.sectionIds)].sort(),
  exceptions:[...config.exceptions].map(({studentId,kind,reason})=>({studentId,kind,reason})).sort((a,b)=>compareId(a.studentId,b.studentId)||compareId(a.kind,b.kind)),
  members:[...roster].sort((a,b)=>compareId(a.studentId,b.studentId)).map(({studentId,profileRevision,contentHash,originSnapshot})=>({studentId,profileRevision,contentHash,originSnapshot}))};
 return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}
