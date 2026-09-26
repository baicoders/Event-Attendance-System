"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/globals/components/shad-cn/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/globals/components/shad-cn/sheet";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { useStatsOfEvent } from "@/globals/hooks/useEvents";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/globals/utils/queryKeys";
import { fetchApi } from "@/globals/utils/api";
import { fullName } from "@/globals/utils/formatting";
import Scanner from "@/features/attendance/components/Scanner";
import ManualAttendanceSection from "@/features/attendance/components/ManualAttendanceSection";
import { useAttendanceEventContext } from "@/features/attendance/hooks/useAttendanceEventContext";
import { useAttendanceOperation } from "@/features/attendance/hooks/useAttendanceOperation";
import useToggleTimeoutMode from "@/features/attendance/hooks/useStartTimeoutMode";
import { Attempt, OperationRequest } from "@/features/attendance/utils/operationCoordinator";
import { canSubmitAttendance } from "@/features/attendance/utils/captureGate";
import { Student } from "@/globals/types/students";

function label(attempt: Attempt) {
  const action = attempt.expectedMode === "TIME_IN" ? "Time-in" : "Time-out";
  if (attempt.outcome === "RECORDED") return `${action} recorded`;
  if (attempt.outcome === "ALREADY_RECORDED") return `${action} already recorded`;
  if (attempt.outcome === "MODE_CHANGED") return "Event mode changed";
  if (attempt.outcome === "RESULT_UNKNOWN") return "Result unknown";
  if (attempt.outcome === "LOOKUP_FAILED") return "Student lookup failed";
  return "Attendance not recorded";
}

const displayTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function OperatorPageInner() {
  const router = useRouter();
  const confirm = useConfirm();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { eventId, selectedEvent, isRestoring, isUnavailable, hasRefreshError, lastCheckedAt, refetchEvent, retryContext } = useAttendanceEventContext();
  const mode = selectedEvent?.isTimeout ? "TIME_OUT" as const : "TIME_IN" as const;
  const context = selectedEvent && user ? { eventId: selectedEvent.id, viewerId: user.id, expectedMode: mode } : null;
  const { state, submit, acknowledge } = useAttendanceOperation(context);
  const stats = useStatsOfEvent(selectedEvent?.id, true);
  const toggleMode = useToggleTimeoutMode();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [desktopLayout, setDesktopLayout] = useState(false);
  const [manualFocusRequest, setManualFocusRequest] = useState(0);
  const [selection, setSelection] = useState<{ student: Student; eventId: string; viewerId: string } | null>(null);
  const selectedStudent = selection && selection.eventId === selectedEvent?.id && selection.viewerId === user?.id ? selection.student : null;
  const [modeNotice, setModeNotice] = useState("");
  const [resolution, setResolution] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [modeChanging, setModeChanging] = useState(false);
  const modeChangingRef = useRef(false);
  const previousMode = useRef<string | null>(null);
  const restoreCamera = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateLayout = () => setDesktopLayout(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    setSelection(null);
    setCameraOpen(false);
    setManualOpen(false);
    setModeNotice("");
    setResolution("");
    previousMode.current = null;
  }, [selectedEvent?.id, user?.id]);

  useEffect(() => {
    if (!selectedEvent) return;
    if (previousMode.current && previousMode.current !== mode) {
      setCameraOpen(false);
      setModeNotice(`Event mode changed to ${mode === "TIME_IN" ? "TIME IN" : "TIME OUT"}. Review it before continuing.`);
    }
    previousMode.current = mode;
  }, [selectedEvent, mode]);

  useEffect(() => {
    const onVisibility = () => {
      if (!selectedEvent) return;
      if (document.hidden) {
        setCameraOpen(false);
        setNeedsRefresh(true);
      } else {
        void refetchEvent().then(({ isError }) => { if (!isError) setNeedsRefresh(false); });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refetchEvent, selectedEvent]);

  const busy = state.phase === "LOOKUP" || state.phase === "SAVING";
  const observedModeChanged = previousMode.current !== null && previousMode.current !== mode;
  const captureAllowed = canSubmitAttendance({ phase: state.phase, modeNotice: !!modeNotice || observedModeChanged,
    hasRefreshError, needsRefresh, modeChanging });
  const capturePaused = !captureAllowed || manualOpen;

  const exit = async () => {
    if (busy || state.lastResult?.outcome === "RESULT_UNKNOWN") {
      const proceed = await confirm({ title: "Leave operator mode?", description: "A sent attendance write may still be unresolved. Leaving does not cancel it. Check the current record before trying again." });
      if (!proceed) return;
    }
    setCameraOpen(false);
    router.push(eventId ? `/attendance?eventId=${encodeURIComponent(eventId)}` : "/attendance");
  };

  const openManual = () => {
    if (selectedEvent && user) void queryClient.invalidateQueries({
      queryKey: queryKeys.students.fromEvent(selectedEvent.id, user.id), exact: true,
    });
    restoreCamera.current = cameraOpen;
    setCameraOpen(false);
    setManualOpen(true);
    setManualFocusRequest((value) => value + 1);
  };
  const submitAttempt = (request: OperationRequest) => {
    if (!captureAllowed || modeChangingRef.current) return false;
    void submit(request).then((attempt) => {
      if (attempt?.outcome === "MODE_CHANGED") {
        setCameraOpen(false);
        setModeNotice("The event mode changed while you were working. Review the current mode before continuing.");
        void refetchEvent();
      }
    });
    return true;
  };
  const closeManual = (open: boolean) => {
    setManualOpen(open);
    if (!open && restoreCamera.current && captureAllowed) setCameraOpen(true);
    if (!open) restoreCamera.current = false;
  };

  const recordManual = (student: Student) => {
    if (!submitAttempt({ studentId: student.id, method: "MANUAL", student: {
      id: student.id, name: fullName(student.firstName, student.middleName ?? "", student.lastName),
    } })) return;
    restoreCamera.current = false;
    setCameraOpen(false);
  };

  const changeMode = async () => {
    if (!selectedEvent || !captureAllowed || modeChangingRef.current) return;
    modeChangingRef.current = true;
    setModeChanging(true);
    setCameraOpen(false);
    const desired = !selectedEvent.isTimeout;
    try {
      const proceed = await confirm({
      title: `Change all devices to ${desired ? "TIME OUT" : "TIME IN"}?`,
      description: desired ? "Students without a time-in can still be timed out; their time-in stays empty. This changes recording mode for the entire event." : "This changes recording mode for the entire event.",
      });
      if (!proceed) return;
      try {
        await toggleMode.mutateAsync({ eventId: selectedEvent.id, isTimeout: desired });
        const refreshed = await refetchEvent();
        if (refreshed.isError) setModeNotice("Mode change result needs a refresh before scanning.");
      } catch {
        setModeNotice("Mode change result is uncertain. Refresh the event before scanning.");
        await refetchEvent();
      }
    } finally {
      modeChangingRef.current = false;
      setModeChanging(false);
    }
  };

  const checkRecord = async () => {
    const attempt = state.lastResult;
    if (!attempt || !eventId) return;
    try {
      const params = new URLSearchParams({ eventId: attempt.eventId, studentId: attempt.studentId });
      const record = await fetchApi<{ timein: string | null; timeout: string | null } | null>(`/api/records?${params}`);
      const value = attempt.expectedMode === "TIME_IN" ? record?.timein : record?.timeout;
      setResolution(value
        ? `Current record has a ${attempt.expectedMode === "TIME_IN" ? "time-in" : "time-out"} at ${displayTime(value)}. This does not identify which device wrote it.`
        : "No matching timestamp is currently in the record. A delayed request may still finish; review mode before a fresh attempt.");
    } catch {
      setResolution("Could not check the current record. Try the read again before a fresh attempt.");
    }
  };

  if (!selectedEvent) return (
    <section className="mx-auto max-w-3xl p-6">
      <Button variant="outline" onClick={exit}>Exit operator mode</Button>
      <div className="mt-6 rounded-xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">{isRestoring ? "Restoring event…" : "Event unavailable"}</h1>
        <p className="mt-2 text-slate-600">{isUnavailable ? "This event is not an approved event you can access." : hasRefreshError ? "Event details could not be refreshed. Retry before recording." : "Choose an approved event from attendance."}</p>
        {hasRefreshError && <Button className="mt-4" onClick={() => void retryContext()}>Retry event</Button>}
      </div>
    </section>
  );

  const canChangeMode = user?.role === "ADMIN" || selectedEvent.createdById === user?.id;
  const result = state.lastResult;
  const manualSection = <ManualAttendanceSection key={selectedEvent.id + ":" + (user?.id ?? "")}
    selectedEvent={selectedEvent} displayedStudent={selectedStudent} active={manualOpen} inSheet={!desktopLayout}
    floatingResults={desktopLayout}
    onSelect={(student) => setSelection(student && user ? { student, eventId: selectedEvent.id, viewerId: user.id } : null)}
    onRecord={recordManual} operationBusy={!captureAllowed}
    focusRequest={manualFocusRequest} onReturnToScanner={() => closeManual(false)}
    result={state.lastResult} onAcknowledge={acknowledge} />;

  return (
    <section className="mx-auto max-w-7xl space-y-4 p-3 pb-12 sm:p-6">
      <header className="sticky top-0 z-20 rounded-xl border bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={exit}>Exit operator mode</Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold sm:text-2xl">{selectedEvent.title}</h1>
            <p className="text-sm text-slate-600">{selectedEvent.location || "Event location not specified"} · {new Date(selectedEvent.start).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div><p className="text-3xl font-black tracking-wide sm:text-5xl">{mode === "TIME_IN" ? "TIME IN" : "TIME OUT"}</p><p className="text-xs text-slate-600">All scanning devices use this event mode.</p></div>
          {canChangeMode && <Button variant="outline" disabled={!captureAllowed || toggleMode.isPending} onClick={changeMode}>Change mode</Button>}
        </div>
      </header>

      {(modeNotice || hasRefreshError || needsRefresh) && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <p>{modeNotice || "Event details need a fresh check before scanning."}</p>
        {lastCheckedAt > 0 && <p className="text-xs">Last checked {displayTime(new Date(lastCheckedAt).toISOString())}</p>}
        <Button variant="outline" className="mt-2" onClick={async () => { const refreshed = await refetchEvent(); if (!refreshed.isError) { setModeNotice(""); setNeedsRefresh(false); } }}>Review mode and continue</Button>
      </div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Scanner onRead={(studentId) => submitAttempt({ studentId, method: "SCANNED" })}
          isPending={capturePaused} eventId={selectedEvent.id} mode={mode} isOpen={cameraOpen}
          onOpenChange={setCameraOpen} onManualEntry={openManual}
          pausedMessage={manualOpen ? "Scanning paused during manual entry" : undefined} large />
        <div className="min-w-0 space-y-4">
          {desktopLayout && manualOpen ? manualSection : <>
          <div aria-live="polite" className={`min-h-48 rounded-xl border p-5 shadow-sm ${result?.outcome === "RECORDED" ? "border-emerald-300 bg-emerald-50" : "bg-white"}`}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Last result</h2>
            {result ? <>
              <p className="mt-3 text-2xl font-bold">{label(result)}</p>
              <p className="mt-2">{result.name || "Student"}{result.studentId && ` · ${result.studentId}`}</p>
              {result.time && <p className="mt-2 text-sm">{result.outcome === "ALREADY_RECORDED" ? "Original server time" : "Server time"}: {displayTime(result.time)}</p>}
              {result.message && <p role="alert" className="mt-2 text-sm text-amber-800">{result.message}</p>}
              {result.outcome !== "RECORDED" && result.outcome !== "ALREADY_RECORDED" &&
                <p className="mt-2 text-xs text-slate-500">To deliberately rescan the same card, close and reopen the camera after reviewing this result.</p>}
              {!result.time && <p className="mt-2 text-xs text-slate-500">Attempted {displayTime(result.attemptedAt)} (device time)</p>}
              {result.outcome === "RESULT_UNKNOWN" && <Button variant="outline" className="mt-3" onClick={checkRecord}>Check current record</Button>}
              {resolution && <p className="mt-3 text-sm">{resolution}</p>}
              {state.phase === "AWAITING_ACKNOWLEDGEMENT" && <Button className="mt-3" onClick={() => { acknowledge(); setResolution(""); }}>Acknowledge / next student</Button>}
            </> : <p className="mt-4 text-slate-600">Open the camera or select a student manually to begin.</p>}
          </div>
          <Button className="w-full py-6 text-lg" variant="outline" onClick={openManual}>Manual entry</Button>
          </>}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="text-lg font-semibold">Present {stats.isError ? "—" : stats.data?.present ?? "—"} · Eligible {stats.isError ? "—" : stats.data?.eligible ?? "—"}</p>
        <p className="text-xs text-slate-500">{stats.isError ? "Stats refresh failed" : stats.dataUpdatedAt ? `Stats checked ${displayTime(new Date(stats.dataUpdatedAt).toISOString())}` : "Loading stats…"}</p>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Recent attempts · this device, since this view opened</h2>
        {state.recent.length === 0 ? <p className="mt-2 text-slate-500">No attempts yet.</p> : <ol className="mt-3 divide-y">
          {state.recent.map((attempt) => <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><strong>{attempt.name || "Student"}</strong>{attempt.studentId && ` · ${attempt.studentId}`} · {label(attempt)}</span>
            <span className="text-slate-500">{attempt.time ? `${displayTime(attempt.time)} ${attempt.outcome === "ALREADY_RECORDED" ? "(original)" : "(recorded)"}` : `${displayTime(attempt.attemptedAt)} (attempted)`}</span>
          </li>)}
        </ol>}
      </div>
      <Button variant="outline" onClick={exit}>View full attendance / manage records</Button>

      <Sheet open={manualOpen && !desktopLayout} onOpenChange={closeManual}>
        <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-2xl p-4">
          <SheetHeader className="border-b px-0 pb-4 pr-8 pt-1"><SheetTitle>Manual attendance · {selectedEvent.title}</SheetTitle></SheetHeader>
          {manualSection}
        </SheetContent>
      </Sheet>
    </section>
  );
}

export default function OperatorPage() {
  return <Suspense fallback={<p className="p-6">Restoring event…</p>}><OperatorPageInner /></Suspense>;
}
