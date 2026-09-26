"use client";

import { useCallback, useMemo, useState } from "react";
import StudentsDataTable from "./StudentsDataTable";
import { getStudentColumns } from "./StudentsDataTable/studentTableColumn";
import { Student } from "@/globals/types/students";
import { ApiError } from "@/globals/utils/api";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import StudentFormDrawer from "./StudentFormDrawer";
import { StudentFormValues } from "@/globals/schemas/studentSchema";
import { useDeleteStudent, useSaveStudent } from "@/globals/hooks/useStudents";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { StudentListCategory } from "../types";
import { StudentQrModal } from "./StudentQRModal";
import { StudentAttendanceHistorySheet } from "./StudentAttendanceHistorySheet";

interface StudentListClientProps {
  category: StudentListCategory;
  label: string;
  item: string;
  categoryHeading: string;
  students: Student[];
  isLoading: boolean;
  isError?: boolean;
}

const StudentListClient = ({
  category,
  label,
  item,
  categoryHeading,
  students,
  isLoading,
  isError = false,
}: StudentListClientProps) => {
  const [formData, setFormData] = useState<Student>();
  const [isStudentFormOpen, setIsStudentFormOpen] = useState(false);
  const [isStudentCodeOpen, setIsStudentCodeOpen] = useState(false);
  const [qrStudent, setQrStudent] = useState<Student>();
  const [historyStudentId, setHistoryStudentId] = useState<string | null>(null);

  const { mutateAsync: saveStudent } = useSaveStudent();
  const { mutateAsync: deleteStudent } = useDeleteStudent();
  const confirm = useConfirm();

  const handleEdit = useCallback((data: Student) => {
    setFormData(data);
    setIsStudentFormOpen(true);
  }, []);

  const handleAdd = useCallback(() => {
    setFormData(undefined);
    setIsStudentFormOpen(true);
  }, []);

  const handleViewQR = useCallback((student: Student) => {
    setQrStudent(student);
    setIsStudentCodeOpen(true);
  }, []);

  const handleDelete = useCallback(async (studentId: string) => {
    if (!studentId) return;

    const confirmed = await confirm({
      title: "Delete this student?",
      description:
        "All data from this student will be removed. This is an irreversable action.",
    });

    if (!confirmed) return;

    try {
      await deleteStudent(studentId);
      toastSuccess("Student deleted");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : `Failed to delete: ${studentId}`;
      toastDanger(message);
    }
  }, [confirm, deleteStudent]);

  const handleSubmit = useCallback(async (data: StudentFormValues) => {
    try {
      const student = await saveStudent(data);

      if (!student) {
        toastDanger("Failed to add student");
      }

      toastSuccess("Student saved.");
    } catch (error) {
      console.error("Error adding student", error);
      toastDanger("Failed saving student.");
      throw error;
    }
  }, [saveStudent]);

  const columns = useMemo(
    () =>
      getStudentColumns({
        onEdit: handleEdit,
        onDelete: handleDelete,
        onViewQR: handleViewQR,
        onHistory: (student: Student) => setHistoryStudentId(student.id),
      }),
    [handleEdit, handleDelete, handleViewQR],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <StudentsDataTable
        category={category}
        columns={columns}
        data={students}
        isLoading={isLoading}
        isError={isError}
        categoryHeader={label ?? ""}
        categorySubheader={categoryHeading ?? ""}
        groupSlug={item ?? ""}
        onAddStudent={handleAdd}
      />

      <StudentFormDrawer
        key={formData?.id}
        student={formData}
        isOpen={isStudentFormOpen}
        onViewQR={() => formData && handleViewQR(formData)}
        onClose={() => setIsStudentFormOpen(false)}
        onSubmit={handleSubmit}
      />

      <StudentQrModal
        onOpenChange={setIsStudentCodeOpen}
        open={isStudentCodeOpen && !!qrStudent}
        student={qrStudent}
      />
      <StudentAttendanceHistorySheet studentId={historyStudentId} open={!!historyStudentId}
        onOpenChange={open => { if (!open) setHistoryStudentId(null); }} />
    </div>
  );
};

export default StudentListClient;
