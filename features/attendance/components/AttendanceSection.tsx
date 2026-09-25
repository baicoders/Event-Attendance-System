"use client";

import { useEffect, useRef, useState } from "react";
import Scanner from "@/features/attendance/components/Scanner";
import ManualAttendanceSection from "@/features/attendance/components/ManualAttendanceSection";
import { useAttendanceOperation } from "@/features/attendance/hooks/useAttendanceOperation";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { Event } from "@/globals/types/events";
import type { Student } from "@/globals/types/students";

export default function AttendanceSection({ selectedEvent }: { selectedEvent: Event | null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<{ student: Student; eventId: string; viewerId: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualActive, setManualActive] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const scannerRef = useRef<HTMLDivElement>(null);
  const mode = selectedEvent?.isTimeout ? "TIME_OUT" as const : "TIME_IN" as const;
  const context = selectedEvent && user ? { eventId: selectedEvent.id, viewerId: user.id, expectedMode: mode } : null;
  const displayedStudent = selection && selection.eventId === selectedEvent?.id && selection.viewerId === user?.id ? selection.student : null;
  const { state, submit, acknowledge } = useAttendanceOperation(context);
  const busy = state.phase !== "IDLE";

  useEffect(() => {
    setSelection(null);
    setCameraOpen(false);
    setManualActive(false);
  }, [selectedEvent?.id, user?.id]);

  const openManual = () => {
    if (selectedEvent && user) void queryClient.invalidateQueries({
      queryKey: queryKeys.students.fromEvent(selectedEvent.id, user.id), exact: true,
    });
    setCameraOpen(false);
    setManualActive(true);
    setFocusRequest((current) => current + 1);
  };

  if (!selectedEvent) return <div className="flex min-h-80 items-center justify-center rounded-xl border bg-white p-8 text-center">
    <div><h2 className="text-2xl font-semibold">No Event Selected</h2><p className="mt-2 text-slate-600">Select an event first to start attendance.</p></div>
  </div>;

  return <div className="grid w-full gap-3 lg:grid-cols-[1fr_1.2fr]">
    <div ref={scannerRef} className="order-2 space-y-3 lg:order-1">
      <Scanner onRead={(studentId) => { if (!manualActive) void submit({ studentId, method: "SCANNED" }); }}
        isPending={busy || manualActive} eventId={selectedEvent.id} mode={mode}
        isOpen={cameraOpen} onOpenChange={setCameraOpen} onManualEntry={openManual}
        pausedMessage={manualActive ? "Scanning paused during manual entry" : undefined} />
      {state.lastResult?.method === "SCANNED" && <div className="rounded-xl border bg-white p-4" aria-live="polite">
        <p className="font-semibold">{state.lastResult.outcome.replaceAll("_", " ")}</p>
        <p className="text-sm">{state.lastResult.name || "Student"} · {state.lastResult.studentId}</p>
        {state.lastResult.time && <p className="text-sm">Server time: {new Date(state.lastResult.time).toLocaleTimeString()}</p>}
        {state.lastResult.message && <p role="alert" className="text-sm">{state.lastResult.message}</p>}
        {state.phase === "AWAITING_ACKNOWLEDGEMENT" && <button type="button" className="mt-2 underline" onClick={acknowledge}>Acknowledge result</button>}
      </div>}
    </div>
    <div className="order-1 lg:order-2"><ManualAttendanceSection key={selectedEvent.id + ":" + (user?.id ?? "")}
      selectedEvent={selectedEvent} displayedStudent={displayedStudent}
      onSelect={(student) => setSelection(student && user ? { student, eventId: selectedEvent.id, viewerId: user.id } : null)}
      onRecord={(student) => { void submit({ studentId: student.id, method: "MANUAL", student: {
        id: student.id, name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      } }); }}
      operationBusy={busy} onFocusSearch={() => {
        if (!manualActive) openManual();
        else setCameraOpen(false);
      }}
      focusRequest={focusRequest} onReturnToScanner={() => {
        setManualActive(false);
        setCameraOpen(true);
        requestAnimationFrame(() => scannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }}
      result={state.lastResult} onAcknowledge={acknowledge} /></div>
  </div>;
}
