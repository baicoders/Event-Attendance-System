"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/globals/components/shad-cn/button";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useEventRoster } from "@/globals/hooks/useStudents";
import { useRecordOfStudentInEvent } from "@/globals/hooks/useRecords";
import { StudentQrModal } from "@/features/students/components/StudentQRModal";
import { indexManualRoster, searchManualRoster } from "@/features/attendance/utils/manualSearch";
import { detailActionDisabled, manualRecordState } from "@/features/attendance/utils/manualRecordState";
import type { Attempt } from "@/features/attendance/utils/operationCoordinator";
import type { Event } from "@/globals/types/events";
import type { Student } from "@/globals/types/students";

type Props = {
  selectedEvent: Event | null;
  displayedStudent: Student | null;
  onSelect: (student: Student | null) => void;
  onRecord?: (student: Student) => void;
  operationBusy?: boolean;
  active?: boolean;
  focusRequest?: number;
  onFocusSearch?: () => void;
  onReturnToScanner?: () => void;
  result?: Attempt | null;
  onAcknowledge?: () => void;
};

function identity(student: Student) {
  const level = student.schoolLevel === "SHS" ? "SHS" : "College";
  const year = student.yearLevel?.replaceAll("_", " ") ?? "Year unspecified";
  const course = student.schoolLevel === "SHS" ? student.strand : student.program;
  return [level + " / " + year, course || "Group unspecified", student.section || "Section unspecified"].join(" · ");
}

export default function ManualAttendanceSection({ selectedEvent, displayedStudent, onSelect, onRecord,
  operationBusy = false, active = true, focusRequest, onFocusSearch, onReturnToScanner,
  result, onAcknowledge }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(10);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [qrStudent, setQrStudent] = useState<Student | null>(null);
  const [resolution, setResolution] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const firstDetailRef = useRef<HTMLButtonElement>(null);
  const refreshedRejection = useRef<number | null>(null);
  const observedAudience = useRef<{ eventId?: string; scope: string }>({ scope: "" });
  const eventId = selectedEvent?.id;
  const viewerId = user?.id;
  const audienceScope = selectedEvent ? JSON.stringify([selectedEvent.category,
    selectedEvent.includedGroups.map((group) => [group.id, group.slug]).sort((a, b) => a[0].localeCompare(b[0]))]) : "";
  const roster = useEventRoster(eventId, viewerId, active && !!viewerId);
  const refetchRoster = roster.refetch;
  const index = useMemo(() => indexManualRoster(roster.data ?? []), [roster.data]);
  const matches = useMemo(() => query.trim().length >= 2 ? searchManualRoster(index, query) : [], [index, query]);
  const selectedId = active && displayedStudent && eventId ? displayedStudent.id : undefined;
  const recordQuery = useRecordOfStudentInEvent(eventId, selectedId, { live: active, active });
  const recordState = manualRecordState(!!selectedId, recordQuery.isPending || recordQuery.isFetching,
    recordQuery.isError, recordQuery.data ?? null);
  const mode = selectedEvent?.isTimeout ? "TIME_OUT" : "TIME_IN";
  const recordLabel = mode === "TIME_IN" ? "Record time in" : "Record time out";
  const relevantResult = result?.method === "MANUAL" && result.eventId === eventId ? result : null;
  const resultContext = [eventId, viewerId, relevantResult?.id].join(":");
  const resultContextRef = useRef(resultContext);
  resultContextRef.current = resultContext;

  useEffect(() => {
    setQuery("");
    setVisible(10);
    setResultsOpen(true);
    setResolution("");
    onSelect(null);
  // Parent owns selected student; event and viewer changes clear it with local search.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, viewerId]);

  useEffect(() => { if (focusRequest) inputRef.current?.focus(); }, [focusRequest]);

  useEffect(() => {
    if (active && eventId && observedAudience.current.eventId === eventId &&
      observedAudience.current.scope !== audienceScope) void refetchRoster();
    observedAudience.current = { eventId, scope: audienceScope };
  }, [active, eventId, audienceScope, refetchRoster]);

  useEffect(() => { setResolution(""); }, [resultContext]);

  useEffect(() => {
    if (active && selectedId) void recordQuery.refetch();
  // A mode switch changes which timestamp matters; selection itself is handled by the query key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (relevantResult?.outcome === "REJECTED" && /not included|unavailable/i.test(relevantResult.message ?? "") &&
      refreshedRejection.current !== relevantResult.id) {
      refreshedRejection.current = relevantResult.id;
      void refetchRoster();
    }
  }, [relevantResult, refetchRoster]);

  const nextStudent = () => {
    setQuery("");
    setVisible(10);
    setResultsOpen(true);
    setResolution("");
    onSelect(null);
    inputRef.current?.focus();
  };

  const checkCurrentRecord = async () => {
    if (!relevantResult || !eventId) return;
    const checkedContext = resultContext;
    setResolution("Checking current record…");
    try {
      const params = new URLSearchParams({ eventId: relevantResult.eventId, studentId: relevantResult.studentId });
      const response = await fetch("/api/records?" + params);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error("Read failed");
      if (resultContextRef.current !== checkedContext) return;
      const time = relevantResult.expectedMode === "TIME_IN" ? body.data?.timein : body.data?.timeout;
      setResolution(time ? "Current record has a timestamp at " + new Date(time).toLocaleTimeString() + ". This does not prove this device wrote it." :
        "No matching timestamp is currently recorded. A delayed request may still finish; review before retrying.");
    } catch { if (resultContextRef.current === checkedContext) setResolution("Could not check the record. Retry the read before another attempt."); }
  };

  if (!selectedEvent) return null;

  return <section className="min-w-0 rounded-xl border bg-white p-4" aria-label="Manual attendance">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Manual attendance</h2>
      {onReturnToScanner && <Button type="button" variant="outline" onClick={onReturnToScanner}>Return to scanner</Button>}
    </div>
    <label htmlFor="manual-attendance-search" className="mb-1 block text-sm font-medium">Search name or student ID</label>
    <input id="manual-attendance-search" ref={inputRef} type="search" value={query} maxLength={100} autoComplete="off"
      className="w-full rounded-md border px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-slate-500"
      placeholder="Search name or student ID" onFocus={() => { setResultsOpen(true); onFocusSearch?.(); }}
      onChange={(event) => { setQuery(event.target.value.slice(0, 100)); setVisible(10); setResultsOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && resultsOpen && matches.length) { event.preventDefault(); firstDetailRef.current?.focus(); }
        if (event.key === "Escape") { event.preventDefault(); setResultsOpen(false); onSelect(null); inputRef.current?.blur(); }
      }} />
    <p className="mt-1 text-xs text-slate-600">Type at least 2 characters. Student IDs remain text.</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>{roster.dataUpdatedAt ? "Roster checked " + new Date(roster.dataUpdatedAt).toLocaleTimeString() : "Roster not yet loaded"}</span>
      <Button type="button" size="sm" variant="outline" onClick={() => void roster.refetch()} disabled={roster.isFetching}>Refresh roster</Button>
    </div>
    {roster.isFetching && <p role="status" className="mt-2 text-sm">{roster.data ? "Refreshing roster…" : "Loading event roster…"}</p>}
    {roster.isError && <p role="alert" className="mt-2 text-sm text-rose-700">{roster.data ? "Roster refresh failed. Showing last-known candidates; recording checks current eligibility." : "Could not load this event’s roster. Retry the read."}</p>}
    {!roster.isError && roster.data?.length === 0 && <p className="mt-3 text-sm">No students are eligible for this event.</p>}
    {query.trim().length >= 2 && !resultsOpen && <p className="mt-3 text-sm text-slate-600">Results closed. Focus search to show them again.</p>}
    {query.trim().length < 2 ? <p className="mt-3 text-sm text-slate-600">Enter two or more characters to find a student.</p> : resultsOpen &&
      roster.data && <>
        <p className="mt-3 text-sm" aria-live="polite">{matches.length} matching students{matches.length > 50 ? " · Narrow the search to see beyond 50" : ""}</p>
        {matches.length === 0 && <p className="mt-2 text-sm">No matching students in this event.</p>}
        <ul className="mt-2 divide-y rounded-md border">
          {matches.slice(0, visible).map(({ student, displayName }, index) => <li key={student.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="break-words font-semibold">{displayName}</p><p className="text-sm">{student.id}</p>
              <p className="break-words text-xs text-slate-600">{identity(student)}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button ref={index === 0 ? firstDetailRef : undefined} type="button" size="sm" variant="outline" onClick={() => onSelect(student)}
                aria-label={"View details for " + displayName + ", " + student.id}>View details</Button>
              <Button type="button" size="sm" disabled={!onRecord || operationBusy ||
                (displayedStudent?.id === student.id && detailActionDisabled(mode, recordState))} onClick={() => onRecord?.(student)}
                aria-label={recordLabel + " for " + displayName + ", " + student.id}>{recordLabel}</Button>
            </div>
          </li>)}
        </ul>
        {visible < Math.min(matches.length, 50) && <Button type="button" className="mt-3" variant="outline" onClick={() => setVisible((count) => Math.min(count + 10, 50))}>Show more</Button>}
      </>}
    {displayedStudent && <div className="mt-5 rounded-lg border bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div>
        <h3 className="font-semibold">{[displayedStudent.firstName, displayedStudent.middleName, displayedStudent.lastName].filter(Boolean).join(" ")}</h3>
        <p className="text-sm">{displayedStudent.id} · {identity(displayedStudent)}</p></div>
        <Button type="button" size="sm" variant="outline" onClick={() => setQrStudent(displayedStudent)}>View QR</Button></div>
      <div role="status" className="mt-3 text-sm">
        {recordState.kind === "LOADING" && "Checking attendance status…"}
        {recordState.kind === "ERROR" && "Attendance status could not be checked. Status is unknown."}
        {recordState.kind === "NO_RECORD" && "No record was found at the last check."}
        {recordState.kind === "NO_TIME_IN" && "No time-in is recorded at the last check."}
        {recordState.kind === "READY" && "Time in: " + new Date(recordState.record.timein!).toLocaleString() + " · Time out: " + (recordState.record.timeout ? new Date(recordState.record.timeout).toLocaleString() : "not recorded")}
      </div>
      {recordQuery.dataUpdatedAt > 0 && recordState.kind !== "ERROR" && <p className="mt-1 text-xs text-slate-500">Checked {new Date(recordQuery.dataUpdatedAt).toLocaleTimeString()}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={!onRecord || operationBusy || detailActionDisabled(mode, recordState)} onClick={() => onRecord?.(displayedStudent)}>{recordLabel}</Button>
        <Button type="button" variant="outline" onClick={() => void recordQuery.refetch()} disabled={recordQuery.isFetching}>Refresh status</Button>
      </div>
    </div>}
    {relevantResult && <div className={"mt-5 rounded-lg border p-4 " + (relevantResult.outcome === "RECORDED" ? "border-emerald-300 bg-emerald-50" : "bg-slate-50")} aria-live="polite">
      <h3 className="font-semibold">Last result</h3>
      <p className="mt-1">{relevantResult.outcome === "RECORDED" ? (relevantResult.expectedMode === "TIME_IN" ? "Time-in recorded" : "Time-out recorded") :
        relevantResult.outcome === "ALREADY_RECORDED" ? "Already recorded" : relevantResult.outcome.replaceAll("_", " ").toLowerCase()}</p>
      <p className="text-sm">{relevantResult.name || "Student"} · {relevantResult.studentId}</p>
      <p className="text-xs text-slate-600">{relevantResult.expectedMode === "TIME_IN" ? "Time in" : "Time out"} · attempted {new Date(relevantResult.attemptedAt).toLocaleTimeString()} (device time)</p>
      {relevantResult.time && <p className="text-sm">{relevantResult.outcome === "ALREADY_RECORDED" ? "Original server time" : "Server time"}: {new Date(relevantResult.time).toLocaleTimeString()}</p>}
      {relevantResult.message && <p role="alert" className="text-sm text-amber-800">{relevantResult.message}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(relevantResult.outcome === "RECORDED" || relevantResult.outcome === "ALREADY_RECORDED") && <Button type="button" disabled={operationBusy} onClick={nextStudent}>Next student</Button>}
        {relevantResult.outcome === "RESULT_UNKNOWN" && <Button type="button" variant="outline" onClick={() => void checkCurrentRecord()}>Check current record</Button>}
        {relevantResult.outcome !== "RECORDED" && relevantResult.outcome !== "ALREADY_RECORDED" && onAcknowledge && <Button type="button" variant="outline" onClick={onAcknowledge}>Acknowledge result</Button>}
      </div>
      {resolution && <p role="status" className="mt-2 text-sm">{resolution}</p>}
    </div>}
    <StudentQrModal open={!!qrStudent} onOpenChange={(open) => { if (!open) setQrStudent(null); }} student={qrStudent ?? undefined} />
  </section>;
}
