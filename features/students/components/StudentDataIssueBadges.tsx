import {getStudentDataIssues,isEmployeeRecord,STUDENT_ISSUE_LABELS,type StudentIssueInput} from '../issues/dataIssues';
export default function StudentDataIssueBadges({student}:{student:StudentIssueInput}) {
  if(isEmployeeRecord(student))return null;
  const issues=getStudentDataIssues(student);
  return <div aria-label="Student record issues" className="flex flex-wrap gap-2">
    {issues.length ? issues.map(code=><span key={code} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">{STUDENT_ISSUE_LABELS[code]}</span>) : <span className="text-sm text-emerald-700">Record complete</span>}
  </div>;
}
