export const STUDENT_ISSUE_LABELS = {
  MISSING_USN: 'Missing USN', MISSING_LRN: 'Missing LRN',
  MISSING_HOUSE: 'Missing House', MISSING_SECTION: 'Missing Section',
  MISSING_YEAR_LEVEL: 'Missing Year level', MISSING_SCHOOL_LEVEL: 'Missing School level',
  MISSING_PROGRAM: 'Missing Program', MISSING_DEPARTMENT: 'Missing Department',
  MISSING_STRAND: 'Missing Strand',
} as const;
export type StudentIssueCode = keyof typeof STUDENT_ISSUE_LABELS;
export type StudentIssueInput = {
  usn: string | null; lrn: string | null; schoolLevel: string | null; yearLevel: string | null;
  groups?: ReadonlyArray<{category: string; slug: string}>;
};
export const isEmployeeRecord = (student: Pick<StudentIssueInput,'groups'>) => student.groups?.some(group=>group.slug === 'employees') ?? false;
/** Derived on every read: edits, imports and bulk assignments cannot leave stale flags. */
export function getStudentDataIssues(student: StudentIssueInput): StudentIssueCode[] {
  if(isEmployeeRecord(student)) return [];
  const issues: StudentIssueCode[] = [];
  // Either identifier is legitimate at either level; never require both.
  if(!student.usn && !student.lrn) issues.push('MISSING_USN','MISSING_LRN');
  const hasGroup=(category:string)=>student.groups?.some(group=>group.category===category);
  if(!hasGroup('HOUSE')) issues.push('MISSING_HOUSE');
  if(!hasGroup('SECTION')) issues.push('MISSING_SECTION');
  if(!student.yearLevel) issues.push('MISSING_YEAR_LEVEL');
  if(!student.schoolLevel) issues.push('MISSING_SCHOOL_LEVEL');
  if(student.schoolLevel==='COLLEGE') {
    if(!hasGroup('PROGRAM'))issues.push('MISSING_PROGRAM');
    if(!hasGroup('DEPARTMENT'))issues.push('MISSING_DEPARTMENT');
  }
  if(student.schoolLevel==='SHS' && !hasGroup('STRAND'))issues.push('MISSING_STRAND');
  return issues;
}

type SearchStudent = {firstName:string;middleName:string|null;lastName:string;usn:string|null;lrn:string|null};
export function matchesStudentIssueSearch(student:SearchStudent,query:string):boolean {
  const normalize=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
  const name=[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' ');
  return normalize([name,student.usn,student.lrn].filter(Boolean).join(' ')).includes(normalize(query));
}
