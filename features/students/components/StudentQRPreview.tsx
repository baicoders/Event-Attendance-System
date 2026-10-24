"use client";

import { useId, useState } from "react";
import type { Student } from "@/globals/types/students";
import { StudentQRCard } from "./StudentQRCard";
import { resolveQRIdentifier, studentQRIdentifiers, type QRIdentifierType } from "../utils/qrIdentifier";

type Props = {
  student: Student;
  showGroupDetail?: boolean;
  fillHeight?: boolean;
  identifierType?: QRIdentifierType;
  onIdentifierTypeChange?: (type: QRIdentifierType) => void;
};

export function StudentQRPreview({ student, showGroupDetail = true, fillHeight = true, identifierType, onIdentifierTypeChange }: Props) {
  const selectId = useId();
  const [localType, setLocalType] = useState<QRIdentifierType>("USN");
  const preferred = identifierType ?? localType;
  const selected = resolveQRIdentifier(student, preferred);
  const available = studentQRIdentifiers(student);

  return <div className="space-y-3">
    {available.length > 1 && <div className="space-y-1 no-print">
      <label htmlFor={selectId} className="block text-xs font-semibold text-slate-600">QR identifier</label>
      <select id={selectId} value={selected.type} onChange={event => {
        const next = event.target.value as QRIdentifierType;
        setLocalType(next);
        onIdentifierTypeChange?.(next);
      }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
        {available.map(identifier => <option key={identifier.type} value={identifier.type}>{identifier.type} — {identifier.value}</option>)}
      </select>
    </div>}
    <StudentQRCard student={student} showGroupDetail={showGroupDetail} fillHeight={fillHeight} identifierType={preferred} />
  </div>;
}
