"use client";

import { memo } from "react";
import { Student } from "@/globals/types/students";
import { StudentQRCard } from "./StudentQRCard";

type Props = {
  students: Student[];
  size: "standard" | "large";
};

export const StudentQRPrintGrid = memo(function StudentQRPrintGrid({ students, size }: Props) {
  const cardsPerPage = size === "standard" ? 12 : 6;

  return (
    <div className={`student-qr-print-area student-qr-print-${size}`} aria-hidden="true">
      {Array.from({ length: Math.ceil(students.length / cardsPerPage) }, (_, index) => (
        <div className="student-qr-print-sheet" key={index}>
          {students.slice(index * cardsPerPage, (index + 1) * cardsPerPage).map((student) => (
            <StudentQRCard key={student.id} student={student} />
          ))}
        </div>
      ))}
    </div>
  );
});
