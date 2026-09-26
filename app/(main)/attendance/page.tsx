"use client";

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AttendancePageHeader from "@/features/attendance/components/AttendancePageHeader";
import AttendanceSection from "@/features/attendance/components/AttendanceSection";
import AttendanceRecordsTable from "@/features/attendance/components/AttendanceRecordsTable";
import { useAttendanceEventContext } from "@/features/attendance/hooks/useAttendanceEventContext";
import { page } from "@/globals/constants/designTokens";

const RestoringState = () => (
  <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-gray-500 shadow-sm">
    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
    <span className="text-lg">Restoring event…</span>
  </div>
);

const AttendancePageInner = () => {
  const { selectedEvent, isRestoring, selectEventId } = useAttendanceEventContext(true);

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        <AttendancePageHeader
          selectedEvent={selectedEvent}
          onSelectEventId={selectEventId}
        />
        {isRestoring ? (
          <RestoringState />
        ) : (
          <>
            <AttendanceSection selectedEvent={selectedEvent} />
            <AttendanceRecordsTable selectedEvent={selectedEvent} />
          </>
        )}
      </div>
    </section>
  );
};

// useSearchParams needs a Suspense boundary during prerender.
const AttendancePage = () => (
  <Suspense fallback={null}>
    <AttendancePageInner />
  </Suspense>
);

export default AttendancePage;
