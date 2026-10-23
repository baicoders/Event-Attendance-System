import StatusBadge from "@/globals/components/shared/StatusBadge";
import {
  getStudentDataIssues,
  isEmployeeRecord,
  STUDENT_ISSUE_LABELS,
  type StudentIssueInput,
} from "../issues/dataIssues";
export default function StudentDataIssueBadges({
  student,
}: {
  student: StudentIssueInput;
}) {
  if (isEmployeeRecord(student)) return null;
  const issues = getStudentDataIssues(student);
  return (
    <div aria-label="Student record issues" className="flex flex-wrap gap-2">
      {issues.length ? (
        issues.map((code) => (
          <StatusBadge
            key={code}
            tone="warning"
            className="px-2 py-0.5 text-[11px]"
          >
            {STUDENT_ISSUE_LABELS[code]}
          </StatusBadge>
        ))
      ) : (
        <StatusBadge tone="success">Record complete</StatusBadge>
      )}
    </div>
  );
}
