"use client";

import { StudentQRCard } from "./StudentQRCard";

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
};

export function StudentQrModal({
  open,
  onOpenChange,
  student,
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

        <div className="mx-auto w-full max-w-64 py-4"><StudentQRCard student={student} /></div>
      </DialogContent>
    </Dialog>
  );
}
