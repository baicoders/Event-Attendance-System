"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/globals/components/shad-cn/button";
import { page } from "@/globals/constants/designTokens";
import { useAttendanceReview } from "../hooks/useAttendanceCorrections";
import { AttendanceCorrectionSheet } from "./AttendanceCorrectionSheet";

const displayTime = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "—";
type Action = "HISTORY" | "CORRECT" | "VOID" | "RESTORE";

export default function AttendanceReviewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const [studentId, setStudentId] = useState(searchParams.get("studentId"));
  const [action, setAction] = useState<Action>("HISTORY");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "recorded" | "voided">("all");
  const [pageNumber, setPageNumber] = useState(1);
  const params = useMemo(() => new URLSearchParams({ search, state, page: String(pageNumber), pageSize: "25" }), [search, state, pageNumber]);
  const review = useAttendanceReview(eventId, params);

  const openStudent = (id: string, mode: Action) => {
    setStudentId(id); setAction(mode);
    router.replace(`/attendance/corrections?eventId=${encodeURIComponent(eventId)}&studentId=${encodeURIComponent(id)}`, { scroll: false });
  };
  const closeStudent = () => {
    setStudentId(null);
    router.replace(`/attendance/corrections?eventId=${encodeURIComponent(eventId)}`, { scroll: false });
  };

  return <section className={`${page.surface} min-h-svh`}><div className={`${page.containerWide} space-y-6 py-6 [&_button]:min-h-10`}>
    <div className="space-y-2"><Link href={`/attendance?eventId=${encodeURIComponent(eventId)}`} className="text-sm font-medium text-slate-700 underline">← Attendance</Link>
      <h1 className="text-2xl font-bold text-slate-900">Attendance review</h1>
      <p className="text-sm text-slate-600">{review.data?.eventTitle ?? "Review recorded evidence"}. Times shown in Asia/Manila (UTC+08:00).</p>
    </div>
    {!eventId && <p role="alert">Choose an event from Attendance to review its evidence.</p>}
    {eventId && <>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setPageNumber(1); setSearch(searchInput.trim()); }}>
        <label className="min-w-56 flex-1 text-sm">Search recorded student name or ID
          <input className="mt-1 block w-full rounded-md border p-2" value={searchInput} maxLength={100} onChange={(event) => setSearchInput(event.target.value)} /></label>
        <label className="text-sm">Evidence
          <select className="mt-1 block min-h-10 rounded-md border p-2" value={state} onChange={(event) => { setState(event.target.value as typeof state); setPageNumber(1); }}>
            <option value="all">All evidence</option><option value="recorded">Current records</option><option value="voided">Voided records</option>
          </select></label>
        <Button type="submit" className="self-end">Search</Button>
      </form>
      {review.isLoading && <p role="status">Loading recorded evidence…</p>}
      {review.isError && <div role="alert">Could not load review evidence. <Button variant="outline" onClick={() => void review.refetch()}>Retry</Button></div>}
      {review.data && <div className="space-y-3">
        <p className="text-sm text-slate-600">Showing {review.data.items.length ? (pageNumber - 1) * 25 + 1 : 0}–{Math.min(pageNumber * 25, review.data.total)} of {review.data.total} recorded or historical student-event pairs.</p>
        {!review.data.items.length && <p className="rounded-lg border p-6 text-sm">No recorded or historical evidence matches this search.</p>}
        <div className="space-y-2">{review.data.items.map((row) => <article key={row.studentId} className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">{row.studentLabel}</p><p className="text-sm text-slate-600">{row.studentId}</p>
            {!row.inCurrentAudience && <p className="text-sm text-amber-700">Outside current event audience</p>}</div>
          <div className="text-sm">{row.record ? <><p>In {displayTime(row.record.timein)}</p><p>Out {displayTime(row.record.timeout)}</p></> : <p>Voided · no current record</p>}</div>
          <div className="flex flex-wrap gap-2">
            {row.record && <Button variant="outline" onClick={() => openStudent(row.studentId, "CORRECT")}>Correct</Button>}
            <Button variant="outline" onClick={() => openStudent(row.studentId, "HISTORY")}>History</Button>
            {!row.record && row.latestAction === "VOID" && <Button variant="outline" onClick={() => openStudent(row.studentId, "RESTORE")}>Restore</Button>}
          </div>
        </article>)}</div>
        <div className="flex gap-2"><Button variant="outline" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>Previous</Button>
          <Button variant="outline" disabled={pageNumber * 25 >= review.data.total} onClick={() => setPageNumber((value) => value + 1)}>Next</Button></div>
      </div>}
    </>}
    <AttendanceCorrectionSheet eventId={eventId} studentId={studentId} initialAction={action} onClose={closeStudent} />
  </div></section>;
}
