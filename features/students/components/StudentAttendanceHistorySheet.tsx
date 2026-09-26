"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import { StudentAttendanceHistoryPanel } from "./StudentAttendanceHistoryPanel";

export function StudentAttendanceHistorySheet({ studentId, open, onOpenChange }: {
  studentId: string | null; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="w-full max-w-none overflow-y-auto p-4 sm:w-[min(900px,95vw)] sm:max-w-none sm:p-6">
      <SheetHeader><SheetTitle>Attendance history</SheetTitle>
        <SheetDescription>Recorded participation and comparison with the student’s current roster.</SheetDescription>
      </SheetHeader>
      {open && studentId && <StudentAttendanceHistoryPanel key={studentId} studentId={studentId} />}
    </SheetContent>
  </Sheet>;
}
