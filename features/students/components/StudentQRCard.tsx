"use client";

import { memo } from "react";
import QRCode from "react-qr-code";
import { Student } from "@/globals/types/students";
import { formatSection } from "@/globals/utils/formatting";

export const StudentQRCard = memo(function StudentQRCard({ student, showGroupDetail = true, fillHeight = true }: { student: Student; showGroupDetail?: boolean; fillHeight?: boolean }) {
  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const group = student.program || student.strand || student.department || student.house;
  const detail = showGroupDetail ? [group?.toUpperCase(), student.section && formatSection(student.section)].filter(Boolean).join(" • ") : "";

  return (
    <article className={`student-qr-card flex flex-col items-center justify-center rounded-xl border border-slate-300 bg-white p-3 text-center text-slate-950 ${fillHeight ? "h-full" : ""}`}>
      <div className="student-qr-code bg-white p-2">
        <QRCode value={student.id} size={160} bgColor="#FFFFFF" fgColor="#000000" className="h-auto w-full" />
      </div>
      <h3 className="mt-2 max-w-full break-words text-sm font-bold uppercase leading-tight">{name}</h3>
      <p className="mt-1 break-all text-xs font-semibold">{student.id}</p>
      {detail && <p className="mt-1 max-w-full break-words text-xs text-slate-700">{detail}</p>}
    </article>
  );
});
