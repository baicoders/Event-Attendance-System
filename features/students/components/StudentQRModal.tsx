"use client";

import { StudentQRPreview } from "./StudentQRPreview";
import type { QRIdentifierType } from "../utils/qrIdentifier";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/globals/components/shad-cn/dialog";
import { Student } from "@/globals/types/students";

type StudentQrModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student | undefined;
  showGroupDetail?: boolean;
  identifierType?: QRIdentifierType;
  onIdentifierTypeChange?: (type: QRIdentifierType) => void;
};

export function StudentQrModal({
  open,
  onOpenChange,
  student,
  showGroupDetail = true,
  identifierType,
  onIdentifierTypeChange,
}: StudentQrModalProps) {
  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <DialogTitle>Student QR Code</DialogTitle>
          <DialogDescription>
            Use this QR code when recording attendance for this student.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-auto w-full max-w-64 py-4"><StudentQRPreview key={student.id} student={student} showGroupDetail={showGroupDetail} identifierType={identifierType} onIdentifierTypeChange={onIdentifierTypeChange} /></div>
      </DialogContent>
    </Dialog>
  );
}
