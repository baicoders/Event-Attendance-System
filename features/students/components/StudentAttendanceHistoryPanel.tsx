"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/globals/components/shad-cn/alert";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { schoolDate } from "@/globals/schemas/studentHistory";
import type { HistoryOutcomeFilter, HistoryView, StudentHistoryRow } from "@/globals/types/studentHistory";
import { useStudentAttendanceHistory } from "../hooks/useStudentAttendanceHistory";

const DAY = 86_400_000;
const displayLabels: Record<StudentHistoryRow["displayState"], string> = {
  PRESENT: "Present", LATE: "Late", INCOMPLETE_RECORD: "Incomplete record",
  ABSENT_CURRENT_ROSTER: "Absent under current roster", NOT_YET_CHECKED_IN: "Not yet checked in",
  NOT_STARTED: "Not started", REVIEW_REQUIRED: "Review required",
};
const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", timeStyle: "short" });
const formatDate = (value: string) => dateFormat.format(new Date(value));
const formatTime = (value: string | null) => value ? timeFormat.format(new Date(value)) : "—";
const defaultRange = () => {
  const today = schoolDate(new Date());
  return { from: new Date(Date.parse(`${today}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10), to: today };
};

export function StudentAttendanceHistoryPanel({ studentId, enabled = true, variant = "full" }: {
  studentId: string; enabled?: boolean; variant?: "full" | "recent";
}) {
  const [view, setView] = useState<HistoryView>("recorded");
  const [range, setRange] = useState(defaultRange);
  const [outcome, setOutcome] = useState<HistoryOutcomeFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  const actualView = variant === "recent" ? "recorded" : view;
  const params = useMemo(() => new URLSearchParams({ view: actualView, from: range.from, to: range.to,
    outcome: variant === "recent" ? "all" : outcome, search: variant === "recent" ? "" : debouncedSearch,
    page: String(variant === "recent" ? 1 : page), pageSize: String(variant === "recent" ? 5 : pageSize) }),
    [actualView, range.from, range.to, outcome, debouncedSearch, page, pageSize, variant]);
  const query = useStudentAttendanceHistory(studentId, params, enabled);
  const data = query.data?.student.id === studentId ? query.data : undefined;
  const changeView = (next: HistoryView) => { setView(next); setPage(1); };
  const changeOutcome = (next: HistoryOutcomeFilter) => { setOutcome(next); setPage(1); };

  return <section className="flex min-h-0 flex-col gap-4" aria-label="Student attendance history">
    {variant === "full" && <>
      <div role="tablist" aria-label="History view" className="flex flex-wrap gap-2">
        {(["recorded", "current-roster"] as const).map(value =>
          <button key={value} type="button" role="tab" aria-selected={view === value}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${view === value ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300"}`}
            onClick={() => changeView(value)}>{value === "recorded" ? "Recorded participation" : "Current-roster comparison"}</button>)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">Event start dates from
          <input className="rounded border px-2 py-1" type="date" value={range.from} max={range.to}
            onChange={e => { setRange(old => ({ ...old, from: e.target.value })); setPage(1); }} /></label>
        <label className="flex flex-col gap-1 text-sm">Through
          <input className="rounded border px-2 py-1" type="date" value={range.to} min={range.from}
            onChange={e => { setRange(old => ({ ...old, to: e.target.value })); setPage(1); }} /></label>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { setRange(defaultRange()); setPage(1); }}>Last 90 days</button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void query.refetch()}>Refresh</button>
      </div>
    </>}
    {data && <>
      <div className="text-sm"><strong>{data.student.displayName}</strong> · {data.student.id}
        <div className="text-slate-600">Current groups: {data.student.schoolLevel} / {data.student.groups.join(" / ") || "None"}</div>
        <div className="text-xs text-slate-500">Checked {formatDate(data.evaluatedAt)}, {formatTime(data.evaluatedAt)} · Asia/Manila{query.isFetching ? " · Refreshing…" : ""}</div>
      </div>
      {actualView === "current-roster" && <Alert>
        <AlertTitle className="line-clamp-none">Current-roster comparison — not a historical enrollment record</AlertTitle>
        <AlertDescription>The system does not know which groups this student belonged to then. Only approved events scheduled entirely before today enter this rate. Group and event edits can change it. Do not use this as a clearance or disciplinary assessment.</AlertDescription>
      </Alert>}
      <div className="flex flex-wrap gap-2" aria-label="History summary">
        {actualView === "recorded" ? <>
          <StatusBadge tone="primary">{data.summary.recordedTimeIns} recorded time-ins</StatusBadge>
          <StatusBadge>{data.summary.incompleteRecordedRows} incomplete records</StatusBadge>
          <StatusBadge>{data.summary.recordedTimeInsOutsideCurrentScope} time-ins outside current audience</StatusBadge>
        </> : <>
          <StatusBadge tone="primary">{data.summary.comparisonAttended} / {data.summary.comparisonEvents} matching events</StatusBadge>
          <StatusBadge>{data.summary.comparisonAbsent} missing time-in</StatusBadge>
          <StatusBadge>{data.summary.comparisonRatePercent === null ? "—" : `${data.summary.comparisonRatePercent.toFixed(1)}%`} attendance rate</StatusBadge>
        </>}
      </div>
      {variant === "full" && <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-sm">Result
          <select className="rounded border px-2 py-1" value={outcome} onChange={e => changeOutcome(e.target.value as HistoryOutcomeFilter)}>
            <option value="all">All rows</option><option value="attended">Recorded time-in</option>
            <option value="late">Late</option><option value="missing">Missing time-in</option>
          </select></label>
        <label className="flex flex-col gap-1 text-sm">Search event title
          <input className="rounded border px-2 py-1" value={search} maxLength={100} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
      </div>}
      {data.rows.length === 0 ? <p className="rounded border p-4 text-sm text-slate-600">{data.rowCount === 0 && (outcome !== "all" || debouncedSearch) ? "No events match these filters." : actualView === "recorded" ? "No recorded participation in this date range." : "No matching current-roster events in this date range."}</p> :
        <div className="max-w-full overflow-x-auto rounded border" tabIndex={0} aria-label="Attendance history table">
          <table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50"><tr>
            <th className="p-3">Date</th><th className="p-3">Event</th><th className="p-3">Result</th>
            <th className="p-3">Time-in / time-out</th><th className="p-3">{actualView === "recorded" ? "Audience now" : "Included in rate"}</th>
          </tr></thead><tbody>{data.rows.map(row => <tr key={row.eventId} className="border-t align-top">
            <td className="p-3 whitespace-nowrap">{formatDate(row.start)}</td>
            <td className="p-3"><div className="font-medium">{row.title}</div><Link className="text-indigo-700 underline" href={`/reports/events/${encodeURIComponent(row.eventId)}`}>Open event report</Link></td>
            <td className="p-3">{actualView === "current-roster" && row.countedInComparison && !row.timein ? "Absent under current roster" : displayLabels[row.displayState]}
              {row.recordId && !row.timein && actualView === "current-roster" && <span className="block text-xs">Incomplete record</span>}</td>
            <td className="p-3 whitespace-nowrap">{formatTime(row.timein)} / {formatTime(row.timeout)}{row.timein && !row.timeout && <span className="block text-xs">No time-out recorded</span>}</td>
            <td className="p-3">{actualView === "recorded" ? row.currentlyEligible ? "Matches" : "Does not match" : row.countedInComparison ? "Yes" : row.comparisonExclusionReason === "INVALID_SCHEDULE" ? "No — review schedule" : "No — not before today"}</td>
          </tr>)}</tbody></table>
        </div>}
      {variant === "full" && <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>{data.rowCount ? `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.rowCount)} of ${data.rowCount}` : "Showing 0 rows"}</span>
        <div className="flex items-center gap-2"><label>Rows <select className="rounded border p-1" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option>10</option><option>25</option><option>50</option><option>100</option></select></label>
          <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
          <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={data.page * data.pageSize >= data.rowCount} onClick={() => setPage(data.page + 1)}>Next</button></div>
      </div>}
      <p className="text-xs text-slate-500">Surviving records for approved events in this event-start date range. Current names, groups, and schedules are not historical snapshots.</p>
    </>}
    {query.isLoading && <p role="status">Loading attendance history…</p>}
    {query.isError && <Alert variant="destructive"><AlertTitle>Could not load attendance history</AlertTitle><AlertDescription>{query.error.message}{data && " Showing previously checked data; refresh to retry."}</AlertDescription></Alert>}
  </section>;
}
