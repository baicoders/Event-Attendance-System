import { useCallback, useMemo, useState } from "react";
import { Student } from "@/globals/types/students";
import { Event } from "@/globals/types/events";
import { ComboBoxValue } from "@/globals/components/shared/ComboBox";
import { useStudentsFromEvent } from "@/globals/hooks/useStudents";
import { fullName } from "@/globals/utils/formatting";
import SearchBar from "@/features/attendance/components/SearchBar";
import { useRecordOfStudentInEvent } from "@/globals/hooks/useRecords";
import StudentDetails from "@/features/attendance/components/StudentDetails";
import { surface } from "@/globals/constants/designTokens";
import { cn } from "@/globals/libs/shad-cn";

type StudentDetailsProps = {
  /** The student scanned in the scanner */
  displayedStudent: Student | null;
  /** The event context for filtering students */
  selectedEvent: Event | null;
  /** Whether the current student to be displayed is being fetched */
  isFetching: boolean;
  /** Callback when a student is selected from search */
  onSelect: (student: Student) => void;
  onRecord?: (student: Student) => void;
  operationBusy?: boolean;
  operator?: boolean;
};

/**
 * StudentDetails component displays student information with search functionality
 *
 * Features:
 * - Search students by name within an event context
 * - Display detailed student information
 * - Loading and empty states
 */
const ManualAttendanceSection = ({
  selectedEvent,
  displayedStudent,
  isFetching,
  onSelect,
  onRecord,
  operationBusy,
  operator,
}: StudentDetailsProps) => {
  const [query, setQuery] = useState("");

  const { data: students } = useStudentsFromEvent(selectedEvent?.id, query);
  const { data: studentRecord } = useRecordOfStudentInEvent(
    selectedEvent?.id,
    displayedStudent?.id
  );

  const searchChoices: ComboBoxValue[] = useMemo(() => {
    if (!students) return [];

    return students.map((student) => ({
      label: fullName(
        student.firstName,
        student.middleName ?? "",
        student.lastName
      ),
      value: student.id,
    }));
  }, [students]);

  const handleSelectStudent = useCallback((studentId: string) => {
    const selectedStudent = students?.find((s) => s.id === studentId);
    if (!selectedStudent) return;

    onSelect(selectedStudent);
  }, [students, onSelect]);

  if (!selectedEvent) return null;

  return (
    <div className={cn(surface.card, "flex flex-col overflow-hidden")}>
      {/* Search Header */}
      <div className="border-b border-slate-200 bg-slate-100 p-4">
        <SearchBar
          onQueryChange={setQuery}
          placeholder="Search student by name..."
          choices={searchChoices}
          onSelect={handleSelectStudent}
        />
      </div>

      {/* Details Content */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <StudentDetails
          event={selectedEvent}
          student={displayedStudent}
          record={studentRecord ?? null}
          isLoading={isFetching}
          onRecord={onRecord}
          operationBusy={operationBusy}
          operator={operator}
        />
      </div>
    </div>
  );
};

export default ManualAttendanceSection
