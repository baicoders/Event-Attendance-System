import { createHash } from 'node:crypto';
import { projectStudentContent, contentVersion } from '@/globals/utils/studentContentVersion';
import type { ParsedImportRow, ExistingImportStudent, ImportGroup } from './contract';

export function importHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Ordered CSV identities bind explicit absence as well as every persisted membership. */
export function hashImportReview(rows: ParsedImportRow[], students: ExistingImportStudent[], groups: ImportGroup[]): string {
  const byId = new Map(students.map(s => [s.id,s]));
  const vocabulary = new Map<string, ImportGroup>();
  for (const s of students) for (const g of s.groups) vocabulary.set(g.id,g);
  for (const g of groups) vocabulary.set(g.id,g);
  return importHash({
    v:1,
    students: rows.map(r => {
      const s = byId.get(r.student.id);
      return [r.csvRow,r.student.id,s ? contentVersion(projectStudentContent({
        ...s,createdAt:new Date(s.createdAt),updatedAt:new Date(s.updatedAt),
        groups:s.groups.map(g => ({...g,category:g.category as never})),
      })) : null];
    }),
    groups:[...vocabulary.values()].map(g=>({id:g.id,slug:g.slug,name:g.name,category:g.category})).sort((a,b)=>a.id.localeCompare(b.id)),
  });
}
