import { Student } from "@/globals/types/students";
import { FaUser } from "react-icons/fa6";
import AttendanceActionButtons from "@/features/attendance/components/AttendanceActionButtons";
import { Event } from "@/globals/types/events";
import { memo, useState } from "react";
import { QrCode } from "lucide-react";
import AttendanceStatusCard from "@/features/attendance/components/AttendanceStatusCard";
import { StudentQrModal } from "@/features/students/components/StudentQRModal";
import { capitalizeLabel } from "@/globals/utils/text";
import { formatSection, fullName, normalizeName } from "@/globals/utils/formatting";
import { labelForGroup } from "@/globals/constants/groups";
import { Record } from "@/globals/types/records";
import { useAuth } from "@/globals/contexts/AuthContext";
import { cn } from "@/globals/libs/shad-cn";

type DetailRowProps = {
  label: string;
  value: string | number;
  show?: boolean;
  /** Extra classes for the value span - used to force-uppercase acronym-style codes (program/strand). */
  valueClassName?: string;
};

function formatDate(date: Date) {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DetailRow = ({ label, value, show = true, valueClassName }: DetailRowProps) => {
  if (!show) return null;
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className={cn("text-base font-medium text-slate-900", valueClassName)}>
        {value}
      </span>
    </div>
  );
};

const LoadingState = () => (
  <div className="flex min-h-[240px] flex-1 items-center justify-center">
    <div className="flex items-center gap-3">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-900" />
      <p className="text-slate-600 text-lg">Loading student details...</p>
    </div>
  </div>
);

const EmptyState = () => (
  <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 sm:gap-4">
    <FaUser className="text-slate-300 text-4xl sm:text-6xl" />
    <p className="text-slate-400 text-lg font-medium sm:text-2xl">
      No Student Found
    </p>
  </div>
);

type Props = {
  student: Student | null;
  event: Event;
  record: Record | null;
  isLoading: boolean;
  onRecord?: (student: Student) => void;
  operationBusy?: boolean;
  operator?: boolean;
};

const StudentDetails = ({ event, student, record, isLoading, onRecord, operationBusy, operator }: Props) => {
  const [qrStudent, setQrStudent] = useState<Student>();
  const { user } = useAuth();
  const canManage =
    user?.role === "ADMIN" || event.createdById === user?.id;

  if (isLoading) return <LoadingState />;
  if (!student) return <EmptyState />;

  const {
    id,
    firstName,
    middleName,
    lastName,
    schoolLevel,
    yearLevel,
    program,
    strand,
    section,
    house,
    department,
  } = student;

  const fullNameDisplay = fullName(firstName, middleName ?? "", lastName);
  const isCollege = schoolLevel === "COLLEGE";
  const isSHS = schoolLevel === "SHS";
  // program or strand + year + section letter
  const programOrStrand = (isCollege ? program : strand)?.toUpperCase() ?? "";
  const fullSection = `${programOrStrand} - ${formatSection(section)} • ${id}`;
  const timeIn = record?.timein ? formatDate(new Date(record?.timein)) : "N/A";
  const timeOut = record?.timeout
    ? formatDate(new Date(record?.timeout))
    : "N/A";

  return (
    <div className="flex w-full flex-1 flex-col sm:flex-row">
      {/* Left side (Attendance Status n' stuff) */}
      <div className="flex flex-row items-center justify-center gap-4 border-b border-slate-200 bg-slate-50/50 p-4 sm:w-28 sm:shrink-0 sm:flex-col sm:justify-start sm:border-b-0 sm:border-r sm:pt-6 sm:p-2">
        <AttendanceStatusCard status={record ? "present" : "absent"} />

        <div className="flex flex-col gap-4 items-center">
          <p className="font-medium border-b-2 border-slate-200">Actions</p>
          <AttendanceActionButtons
            recordId={record?.id}
            eventId={event.id}
            studentId={student.id}
            isTimeout={event.isTimeout}
            hasTimeIn={!!record?.timein}
            hasTimeOut={!!record?.timeout}
            canManage={!operator && canManage}
            onRecord={onRecord ? () => onRecord(student) : undefined}
            operationBusy={operationBusy}
          />
        </div>
      </div>

      {/* Right side (Student details) */}
      <div className="flex-1 p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              {fullNameDisplay}
            </h2>
            <p className="text-slate-500 mt-1 text-sm sm:text-base">{fullSection}</p>
          </div>
          <button
            type="button"
            onClick={() => setQrStudent(student)}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
          >
            <QrCode className="size-4" strokeWidth={1.7} />
            View QR
          </button>
        </div>

        {/* Student Info Grid */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 sm:gap-4">
          <DetailRow
            label="Type"
            value={`${capitalizeLabel(schoolLevel)} Student`}
          />
          {isCollege && (
            <DetailRow
              label="Program"
              value={program || "N/A"}
              valueClassName="uppercase"
            />
          )}
          {isSHS && (
            <DetailRow
              label="Strand"
              value={strand || "N/A"}
              valueClassName="uppercase"
            />
          )}
          <DetailRow
            label="Year & Section"
            value={`${labelForGroup("YEAR", yearLevel)} - ${formatSection(section)}`}
          />
          <DetailRow
            label="Department"
            value={normalizeName(department) || "N/A"}
          />
          <DetailRow label="House" value={normalizeName(house) || "N/A"} />
        </div>

        {/* Attendance record / status row */}
        {record && (
          <>
            <div className="mt-6 border-t border-t-slate-200 pt-2 flex justify-between items-center">
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                Time In at
              </p>
              <span className="text-base font-medium text-slate-900">
                {timeIn}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                Time Out at
              </p>
              <span className="text-base font-medium text-slate-900">
                {timeOut}
              </span>
            </div>
          </>
        )}
      </div>
      <StudentQrModal
        open={qrStudent?.id === student.id}
        onOpenChange={(open) => { if (!open) setQrStudent(undefined); }}
        student={qrStudent}
      />
    </div>
  );
};

export default memo(StudentDetails);
