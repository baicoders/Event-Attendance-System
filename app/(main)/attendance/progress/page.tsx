"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { ApiError } from "@/globals/utils/api";
import { page, surface } from "@/globals/constants/designTokens";
import PageHeader from "@/globals/components/shared/PageHeader";
import DataTable from "@/globals/components/shared/dataTable/DataTable";
import { Button } from "@/globals/components/shad-cn/button";
import { Input } from "@/globals/components/shad-cn/input";
import { useAuth } from "@/globals/contexts/AuthContext";
import { useAttendanceProgress } from "@/features/attendance/hooks/useAttendanceProgress";
import { progressColumns } from "@/features/attendance/constants/progressColumns";
import type { ProgressDimension, ProgressQuery, ProgressStatus } from "@/globals/utils/attendanceProgressQuery";
import type { AttendanceProgressResponse } from "@/globals/utils/attendanceProgressRead";

const dimensions: { value: ProgressDimension; label: string }[] = [
  { value: "SECTION", label: "Section" }, { value: "DEPARTMENT", label: "Department" },
  { value: "PROGRAM", label: "Program" }, { value: "STRAND", label: "Strand" },
  { value: "HOUSE", label: "House" }, { value: "YEAR", label: "Year / grade" },
];
const statuses: { value: ProgressStatus; label: string }[] = [
  { value: "NOT_YET", label: "Not yet checked in" },
  { value: "CHECKED_IN", label: "Checked in" },
  { value: "ALL", label: "All eligible" },
];
const percent = (rate: number | null) => rate === null ? "—" : `${rate.toFixed(1)}%`;
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ProgressPageInner() {
  const eventId = useSearchParams().get("eventId");
  const { user } = useAuth();
  const [groupBy, setGroupBy] = useState<ProgressDimension>("SECTION");
  const [opened, setOpened] = useState(false);
  const [bucket, setBucket] = useState("all");
  const [status, setStatus] = useState<ProgressStatus>("NOT_YET");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [detailPage, setDetailPage] = useState(1);
  const [pageSize, setPageSize] = useState<ProgressQuery["pageSize"]>(50);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusedRequest = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const handleVisibility = () => setHidden(document.hidden);
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { document.removeEventListener("visibilitychange", handleVisibility); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchText.trim()); setDetailPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    setGroupBy("SECTION"); setOpened(false); setBucket("all"); setStatus("NOT_YET");
    setSearchText(""); setSearch(""); setDetailPage(1);
  }, [eventId]);

  const queryInput = useMemo<ProgressQuery>(() => ({
    groupBy, includeRows: opened, bucket, status, q: search, page: detailPage, pageSize,
  }), [groupBy, opened, bucket, status, search, detailPage, pageSize]);
  const result = useAttendanceProgress(eventId, user?.id, queryInput);
  const [lastProgress, setLastProgress] = useState<{ data: AttendanceProgressResponse; receivedAt: number; viewerId: string } | null>(null);
  useEffect(() => {
    if (result.data && user?.id) setLastProgress({ data: result.data, receivedAt: result.dataUpdatedAt, viewerId: user.id });
  }, [result.data, result.dataUpdatedAt, user?.id]);
  const apiError = result.error instanceof ApiError ? result.error : null;
  const denied = !!apiError && [401, 403, 404, 409].includes(apiError.status);
  const invalidBucket = apiError?.code === "INVALID_PROGRESS_BUCKET";
  const sameScopePrevious = lastProgress && lastProgress.viewerId === user?.id && lastProgress.data.event.id === eventId && lastProgress.data.groupBy === groupBy ? lastProgress : null;
  const progress = denied || invalidBucket ? null : result.data ?? sameScopePrevious?.data ?? null;
  const receivedAt = result.data ? result.dataUpdatedAt : sameScopePrevious?.receivedAt ?? 0;
  const stale = !!progress && (result.isError || now - receivedAt > 24_000);
  const detail = result.data?.detail;
  const backHref = eventId ? `/attendance?eventId=${encodeURIComponent(eventId)}` : "/attendance";

  useEffect(() => {
    if (opened && detail && detail.page !== detailPage) setDetailPage(detail.page);
  }, [opened, detail, detailPage]);

  useEffect(() => {
    if (focusRequest > focusedRequest.current && detail) {
      detailHeading.current?.focus();
      detailHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      focusedRequest.current = focusRequest;
    }
  }, [focusRequest, detail]);

  const openDetail = (key: string) => {
    setBucket(key); setStatus("NOT_YET"); setDetailPage(1); setOpened(true);
    setFocusRequest((value) => value + 1);
  };
  const changeDimension = (value: ProgressDimension) => {
    setGroupBy(value); setBucket("all"); setDetailPage(1);
  };

  return (
    <main className={page.surface}>
      <div className={page.containerWide}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 hover:underline"><ArrowLeft className="size-4" /> Back to attendance</Link>
          {progress && <Link href={`/reports/events/${progress.event.id}`} className="text-sm font-medium text-indigo-700 hover:underline">View report</Link>}
        </div>
        <PageHeader variant="plain" eyebrow="Live attendance progress" title={progress?.event.title ?? "Attendance progress"}
          description="Current roster · recorded time-ins, including late arrivals and students who timed out." />

        {!eventId ? (
          <div role="alert" className={`${surface.card} p-6`}>Choose an approved event from attendance to view progress.</div>
        ) : denied ? (
          <div role="alert" className={`${surface.card} p-6`}><p className="font-semibold">Progress unavailable</p><p className="mt-1 text-sm text-slate-600">{apiError?.message}</p><Link href={backHref} className="mt-3 inline-block text-sm text-indigo-700 underline">Back to attendance</Link></div>
        ) : invalidBucket ? (
          <div role="alert" className={`${surface.card} p-6`}><p className="font-semibold">Selected group is no longer available</p><p className="mt-1 text-sm text-slate-600">The selected {groupBy.toLowerCase()} group ({bucket}) changed. Clear it to refresh this view.</p><Button className="mt-3" variant="outline" onClick={() => { setBucket("all"); setDetailPage(1); }}>Clear group</Button></div>
        ) : !progress && result.isError ? (
          <div role="alert" className={`${surface.card} p-6`}><p className="font-semibold">Could not load progress</p><p className="mt-1 text-sm text-slate-600">{apiError?.message ?? "Check the connection and try again."}</p><Button className="mt-3" variant="outline" onClick={() => void result.refetch()}>Retry</Button></div>
        ) : !progress ? (
          <div className={`${surface.card} p-6 text-slate-600`} role="status">Loading attendance progress…</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span>{hidden ? "Updates paused while this page is hidden" : result.isError ? `Could not refresh. Showing the last successful result from ${time(progress.evaluatedAt)}.` : stale ? `Updates delayed. Last successful result: ${time(progress.evaluatedAt)}.` : !result.data ? `Loading selected list. Summary checked at ${time(progress.evaluatedAt)}.` : `Updated ${time(progress.evaluatedAt)}`}</span>
              <Button variant="outline" size="sm" onClick={() => void result.refetch()} disabled={result.isFetching}><RefreshCw className="mr-2 size-4" />{result.isFetching ? "Refreshing…" : stale ? "Retry" : "Refresh"}</Button>
            </div>
            <section className={`${surface.panel} p-6`} aria-label="Overall attendance progress">
              {progress.totals.eligible === 0 ? <p className="text-xl font-semibold">No eligible students <span className="text-slate-500">· Rate —</span></p> : (
                <>
                  <p className="text-sm text-slate-600">Students checked in</p>
                  <p className="mt-1 text-3xl font-semibold">{progress.totals.checkedIn} / {progress.totals.eligible} <span className="text-xl text-indigo-700">{percent(progress.totals.rate)}</span></p>
                  <div role="progressbar" aria-label="Students checked in" aria-valuenow={progress.totals.rate ?? 0} aria-valuemin={0} aria-valuemax={100} className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-indigo-600" style={{ width: `${progress.totals.rate ?? 0}%` }} />
                  </div>
                </>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className={`${surface.card} p-4`}><p className="text-sm text-slate-600">Checked in</p><p className="text-2xl font-semibold">{progress.totals.checkedIn}</p></div>
                <div className={`${surface.card} p-4`}><p className="text-sm text-slate-600">Not yet checked in</p><p className="text-2xl font-semibold">{progress.totals.notYet}</p><Button variant="link" className="h-auto p-0" onClick={() => openDetail("all")}>View students</Button></div>
              </div>
              {progress.totals.eligible > 0 && progress.totals.notYet === 0 && <p className="mt-4 text-sm text-emerald-700">All currently eligible students have a recorded time-in.</p>}
              {progress.diagnostics.recordsWithoutTimeIn > 0 && <p className="mt-4 text-sm text-amber-700">{progress.diagnostics.recordsWithoutTimeIn} eligible record(s) have no time-in and may need review.</p>}
            </section>

            <section className={`${surface.panel} p-6`} aria-label="Attendance breakdown">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Breakdown</h2>
                <label className="flex items-center gap-2 text-sm">Break down by
                  <select className="rounded-md border border-slate-300 bg-white px-3 py-2" value={groupBy} onChange={(event) => changeDimension(event.target.value as ProgressDimension)}>
                    {dimensions.map((dimension) => <option key={dimension.value} value={dimension.value}>{dimension.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[540px] text-left text-sm">
                  <thead><tr className="border-b text-slate-600"><th className="py-2">Group</th><th>Checked in / Eligible</th><th>Not yet</th><th>Rate</th><th><span className="sr-only">Details</span></th></tr></thead>
                  <tbody>{progress.breakdown.map((item) => <tr key={item.bucketKey} className="border-b last:border-0">
                    <th scope="row" className="py-3 font-medium">{item.label}{item.slug && <span className="ml-2 text-xs font-normal text-slate-500">({item.slug})</span>}</th>
                    <td>{item.checkedIn} / {item.eligible}</td><td>{item.notYet}</td><td>{percent(item.rate)}</td>
                    <td><Button variant="link" className="h-auto p-0" onClick={() => openDetail(item.bucketKey)} aria-label={`View missing students for ${item.label}, ${item.notYet} not yet checked in`}>View missing</Button></td>
                  </tr>)}</tbody>
                </table>
                {progress.breakdown.length === 0 && <p className="py-5 text-sm text-slate-600">No groups in the current audience.</p>}
              </div>
            </section>

            {opened && (
              <section aria-label="Student drill-down" className={`${surface.panel} p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 ref={detailHeading} tabIndex={-1} className="text-xl font-semibold outline-none">{statuses.find((item) => item.value === status)?.label} — {detail?.bucketLabel ?? "Loading…"}</h2>
                    {detail && <p className="mt-1 text-sm text-slate-600">{detail.bucketTotals.notYet} of {detail.bucketTotals.eligible} eligible students in this selection have not checked in.</p>}</div>
                  <div className="flex gap-2">{bucket !== "all" && <Button variant="outline" size="sm" onClick={() => { setBucket("all"); setDetailPage(1); }}>Clear group</Button>}<Button variant="ghost" size="sm" onClick={() => setOpened(false)}>Close list</Button></div>
                </div>
                <div className="my-4 flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm">Status
                    <select className="rounded-md border border-slate-300 bg-white px-3 py-2" value={status} onChange={(event) => { setStatus(event.target.value as ProgressStatus); setDetailPage(1); }}>
                      {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <Input aria-label="Search students by name or ID" placeholder="Search this list by name or ID" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={100} className="w-full sm:max-w-xs" />
                </div>
                {result.isError && !detail ? (
                  <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">Could not load the selected student list. The summary above is from the last successful read. <Button variant="link" onClick={() => void result.refetch()}>Retry list</Button></div>
                ) : (
                  <DataTable columns={progressColumns} data={detail?.rows ?? []} getRowId={(row) => row.studentId}
                    showToolbar={false} isLoading={!detail} isError={false}
                    manual={{ pageIndex: (detail?.page ?? 1) - 1, pageSize, rowCount: detail?.matchedCount ?? 0,
                      onPageChange: (index) => setDetailPage(index + 1),
                      onPageSizeChange: (size) => { setPageSize(size as ProgressQuery["pageSize"]); setDetailPage(1); },
                      sorting: [], onSortingChange: () => {}, isPending: result.isFetching,
                      isFiltered: !!search || status !== "ALL" || bucket !== "all" }} />
                )}
                {detail && <p className="mt-3 text-xs text-slate-500">As checked at {time(progress.evaluatedAt)}. Counts can change while attendance continues.</p>}
              </section>
            )}
            <p className="text-xs text-slate-500">Counts follow the current event audience and roster. “Not yet checked in” means no recorded time-in, not finalized absence or current venue occupancy.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function AttendanceProgressPage() {
  return <Suspense fallback={<div className="p-6">Loading attendance progress…</div>}><ProgressPageInner /></Suspense>;
}
