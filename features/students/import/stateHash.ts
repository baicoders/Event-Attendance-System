import { createHash } from 'node:crypto';
import { projectStudentContent, contentVersion } from '@/globals/utils/studentContentVersion';
import type { ParsedImportRow, ExistingImportStudent, ImportGroup } from './contract';
export function importHash(value:unknown):string {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
/** Bind all matching namespaces, including absence, and all current memberships. */
export function hashImportReview(rows:ParsedImportRow[],students:ExistingImportStudent[],groups:ImportGroup[]):string {
 const vocabulary=new Map<string,ImportGroup>();
 for(const student of students)for(const group of student.groups)vocabulary.set(group.id,group);
 for(const group of groups)vocabulary.set(group.id,group);
 return importHash({v:2,identities:rows.map(row=>[row.csvRow,row.student.usn,row.student.lrn]),
  students:[...students].sort((a,b)=>a.id.localeCompare(b.id)).map(student=>contentVersion(projectStudentContent({...student,createdAt:new Date(student.createdAt),updatedAt:new Date(student.updatedAt),groups:student.groups.map(group=>({...group,category:group.category as never}))}))),
  groups:[...vocabulary.values()].map(group=>({id:group.id,slug:group.slug,name:group.name,category:group.category})).sort((a,b)=>a.id.localeCompare(b.id))});
}
