"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Camera, Search, RefreshCw, Download, UserPlus } from "lucide-react";
import { useAuth } from "@/globals/contexts/AuthContext";
import { ApiError, fetchApi } from "@/globals/utils/api";
import { formatReportDateTime, REPORT_TIME_ZONE } from "@/globals/utils/reportTime";
import { studentIdSchema } from "@/globals/schemas/studentId";
import { Button } from "@/globals/components/shad-cn/button";
import { Input } from "@/globals/components/shad-cn/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/globals/components/shad-cn/dialog";
import { page } from "@/globals/constants/designTokens";
import { StudentQRCard } from "@/features/students/components/StudentQRCard";
import { StudentQRPrintGrid } from "@/features/students/components/StudentQRPrintGrid";
import type { Student } from "@/globals/types/students";
import { libraryDay, LIBRARY_SCAN_COOLDOWN_MS, type LibraryPeriod } from "@/features/library/time";
import { parseLibraryScanResult, type LibraryScanResult } from "@/features/library/scanResult";
import type { readLibraryVisits } from "@/features/library/server";

const ScannerCamera = dynamic(() => import("@/features/attendance/components/ScannerCamera"), { ssr: false });
type LibraryData = Awaited<ReturnType<typeof readLibraryVisits>>;
type ScanResult = LibraryScanResult;
type Person = Student & { personType: string };
type Identity = { firstName: string; lastName: string; middleName?: string | null };
const fullName = (p: Identity) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
const personType = (value: string) => value === "EMPLOYEE" ? "Employee" : "Student";
const clock = (value: string | Date | null) => value ? new Date(value).toLocaleTimeString("en-US", { timeZone: REPORT_TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
const panel = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const selectClass = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";

export default function LibraryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => libraryDay());
  const [period, setPeriod] = useState<LibraryPeriod>("daily");
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [demo, setDemo] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message?: string; result?: ScanResult; uncertain?: boolean; studentId?: string } | null>(null);
  const scanBlocked = useRef(false);
  const lastScan = useRef(new Map<string, number>());
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState(false);
  const [lookup, setLookup] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [lookupDone, setLookupDone] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(false);
  const [qrPerson, setQrPerson] = useState<Student | null>(null);
  const [closeDialog, setCloseDialog] = useState(false);
  const [reviewVisit, setReviewVisit] = useState<LibraryData["unclosed"][number] | null>(null);
  const [correctionClock, setCorrectionClock] = useState("");
  const [classifyPerson, setClassifyPerson] = useState<Person | null>(null);

  const query = new URLSearchParams({ date, period, type, search: historySearch, page: String(pageNumber), demo: String(demo) }).toString();
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["library", query], staleTime: 0, queryFn: ({ signal }) => fetchApi<LibraryData>(`/api/library/visits?${query}`, { signal }), retry: false,
  });
  const write = <T,>(path: string, body: unknown) => fetchApi<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function recordScan(raw: string) {
    if (scanBlocked.current || pending || demo) return;
    scanBlocked.current = true;
    setManual(false);
    setNotice("");
    const parsed = studentIdSchema.safeParse(raw);
    if (!parsed.success) { setFeedback({ message: "Malformed identifier: use an existing 11-character visitor ID." }); return; }
    const studentId = parsed.data;
    const last = lastScan.current.get(studentId);
    if (last && Date.now() - last < LIBRARY_SCAN_COOLDOWN_MS) {
      setFeedback({ message: "Duplicate scan: wait 10 seconds after the last scan." }); return;
    }
    setPending(true);
    lastScan.current.set(studentId, Date.now());
    try {
      const result = parseLibraryScanResult(await write<unknown>("/api/library/scan", { studentId, requestId: crypto.randomUUID() }), studentId);
      setFeedback({ result });
      void refetch();
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status < 400 || error.status >= 500;
      setFeedback({ studentId, uncertain, message: uncertain
        ? "Connection problem: attendance result is uncertain. Refresh and check this visitor’s history before intentionally scanning again."
        : error.message });
    } finally { setPending(false); }
  }
  async function checkUncertainHistory() {
    if (!feedback?.studentId) return;
    setPending(true); setNotice("");
    try {
      // Independently read the attempted visitor, regardless of old report filters.
      const params = new URLSearchParams({ period: "daily", type: "ALL", search: feedback.studentId, demo: "false" });
      const saved = await fetchApi<LibraryData>(`/api/library/visits?${params}`);
      const checkedQuery = new URLSearchParams({ date: saved.today, period: "daily", type: "ALL", search: feedback.studentId, page: "1", demo: "false" }).toString();
      queryClient.setQueryData(["library", checkedQuery], saved);
      setDate(saved.today); setPeriod("daily"); setType("ALL"); setDemo(false);
      setSearch(feedback.studentId); setHistorySearch(feedback.studentId); setPageNumber(1); setCamera(false);
      const latest = saved.visits.find(v => v.studentId === feedback.studentId);
      const details = latest ? `Latest saved visit: In ${clock(latest.timeIn)}, Out ${clock(latest.timeOut)}, ${latest.status}.` : "No saved visit today for this ID.";
      setFeedback(v => v ? { ...v, uncertain: false, message: `History refreshed. ${details} Check the saved records before the next intentional scan.` } : v);
    } catch { setNotice("Could not check this visitor’s history. Keep scanning paused and refresh when the connection returns."); }
    finally { setPending(false); }
  }
  function acknowledge() {
    scanBlocked.current = false;
    setFeedback(null);
    setCameraSession(v => v + 1);
  }
  async function lookupPeople(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setNotice("");
    try { setPeople(await fetchApi<Person[]>(`/api/library/people?search=${encodeURIComponent(lookup)}`)); setLookupDone(true); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Lookup failed"); }
    finally { setPending(false); }
  }
  async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true); setNotice("");
    try {
      const person = await write<Student>("/api/library/people", values);
      setEmployeeForm(false); setQrPerson(person); setNotice("Employee registered. Print or view their QR code.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Registration failed"); }
    finally { setPending(false); }
  }
  async function classifyEmployee() {
    if (!classifyPerson) return;
    setPending(true);
    try {
      const person = await write<Student>("/api/library/people", { id: classifyPerson.id, assignExisting: true });
      setClassifyPerson(null); setManual(false); setQrPerson(person); setNotice("Identity classified as Employee. Earlier visit classifications are preserved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Classification failed"); }
    finally { setPending(false); }
  }
  async function closeVisits() {
    setPending(true); setNotice("");
    try {
      const body = reviewVisit ? { demo, visitId: reviewVisit.id, timeOut: new Date(`${correctionClock}:00+08:00`).toISOString() } : { demo };
      const result = await write<{ count: number }>("/api/library/close-forgotten", body);
      setCloseDialog(false); setReviewVisit(null); setNotice(`${result.count} visit(s) closed by librarian.`); void refetch();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Correction failed. Refresh history before trying again."); }
    finally { setPending(false); }
  }
  async function exportCsv() {
    try {
      const response = await fetch(`/api/library/visits?${query}&format=csv`);
      if (!response.ok) throw new Error("Export failed. Refresh or sign in again.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `library-${data?.range.start}-${data?.range.end}${demo ? "-DEMO" : ""}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Export failed"); }
  }

  return <section className={`${page.surface} min-h-svh`}><div className={page.containerWide}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-3xl font-bold"><BookOpen aria-hidden="true" />Library Attendance</h1>
        <p className="mt-2 text-slate-600">{data ? new Date(`${data.today}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: REPORT_TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Loading library date…"}</p>
        <p className="mt-1 text-sm font-medium">Scanner: {demo ? "Disabled in demonstration view" : pending ? "Processing" : feedback ? "Awaiting acknowledgement" : "Ready"}</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw />Refresh</Button>
        {user?.role === "ADMIN" && <Button variant="outline" onClick={() => { setNotice(""); setEmployeeForm(true); }}><UserPlus />Register Employee</Button>}
        <Button variant="outline" asChild><Link href="/attendance">Event Attendance</Link></Button></div>
    </header>
    {notice && <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">History unavailable: {error.message}. Refresh before relying on the displayed counts.</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={demo} onChange={e => { setDemo(e.target.checked); setPageNumber(1); setCamera(false); }} />View simulated demonstration data only</label>
    {demo && <p className="rounded-lg bg-amber-100 p-3 font-medium">DEMONSTRATION DATA — simulated visits, excluded from ordinary library reports. Live scanning is disabled in this view.</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[["Visits Today", data?.summary.visitsToday], ["Currently Inside", data?.summary.currentlyInside], ["Unclosed Visits", data?.summary.unclosedVisits]].map(([label, count]) => <div className={panel} key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-3xl font-bold">{count ?? "—"}</p></div>)}
    </div>
    {data && <p className="-mt-3 text-xs text-slate-500">As of {clock(data.now)} Asia/Manila. Refresh to update. Open visits become unclosed at 5:00 PM every day.</p>}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className={panel} aria-label="Library scanner"><h2 className="text-xl font-semibold">Scan Student / Employee QR Code</h2><p className="mt-1 text-sm text-slate-600">First scan records Time In. Next intentional scan records Time Out. Wait 10 seconds between scans for the same person.</p>
        <div className="my-4 flex flex-wrap gap-2"><Button onClick={() => setCamera(true)} disabled={pending || !!feedback || demo}><Camera />Open Camera</Button><Button variant="outline" onClick={() => { setManual(true); setLookupDone(false); setPeople([]); setLookup(""); setNotice(""); }} disabled={pending || !!feedback || demo}><Search />Manual Search</Button></div>
        {camera && <div className="aspect-square max-h-[420px] overflow-hidden rounded-xl bg-slate-950"><ScannerCamera key={cameraSession} onRead={id => void recordScan(id)} isPending={pending || !!feedback} onClose={() => setCamera(false)} eventId="library" onError={() => { setCamera(false); setNotice("Camera unavailable. Check camera permission or use Manual Search."); }} /></div>}
        {feedback && <div role="status" aria-live="assertive" className={`mt-4 rounded-xl border-2 p-5 ${feedback.result ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>
          {feedback.result ? <><p className="text-2xl font-bold">{feedback.result.operation === "TIME_IN" ? "TIME IN RECORDED" : "TIME OUT RECORDED"}</p><p className="mt-2 text-xl font-semibold">{fullName(feedback.result.visit.student)}</p><p>{personType(feedback.result.visit.personType)}</p><p className="mt-2">{formatReportDateTime(feedback.result.operation === "TIME_IN" ? feedback.result.visit.timeIn : feedback.result.visit.timeOut)} (Asia/Manila)</p></> : <><p className="font-semibold">{feedback.message}</p>{feedback.studentId && <p className="mt-2">Visitor ID: {feedback.studentId}</p>}</>}
          {feedback.uncertain ? <><Button className="mt-4" variant="outline" disabled={pending} onClick={() => void checkUncertainHistory()}>Refresh and check history</Button></> : <Button className="mt-4" onClick={acknowledge}>Next visitor</Button>}
        </div>}
      </section>
      <section className={panel}><h2 className="text-xl font-semibold">Recent Activity</h2><ul className="mt-3 max-h-96 overflow-y-auto divide-y divide-slate-100">{data?.activity.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-semibold">{fullName(a.student)}</p><span className={a.personType === "EMPLOYEE" ? "text-violet-700" : "text-slate-500"}>{personType(a.personType)}</span></div><div className="text-right"><p>{a.action}</p><p className="text-slate-500">{formatReportDateTime(a.at)}</p></div></li>)}</ul>{data?.activity.length === 0 && <p className="mt-4 text-slate-500">No library activity yet.</p>}</section>
    </div>
    <section className={panel}><h2 className="text-xl font-semibold">Currently Inside</h2><p className="mt-1 text-sm text-slate-500">Today’s open visits before the 5:00 PM review threshold.</p><div className="mt-3 flex flex-wrap gap-2">{data?.inside.map(v => <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm" key={v.id}>{fullName(v.student)} · {personType(v.personType)} · {clock(v.timeIn)}</span>)}{data?.inside.length === 0 && <p className="text-sm text-slate-500">No visitors currently inside.</p>}</div></section>
    {(data?.summary.unclosedVisits ?? 0) > 0 && <section className={`${panel} border-amber-300`}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">Unclosed library visits: {data?.summary.unclosedVisits}</h2><p className="text-sm text-slate-600">These visitors have missing Time Outs. After-hours entries require individual review.</p></div><Button onClick={() => { setNotice(""); setCloseDialog(true); }} disabled={pending || !data?.summary.bulkEligible}>Close Forgotten Visits ({data?.summary.bulkEligible})</Button></div><ul className="mt-3 divide-y">{data?.unclosed.map(v => <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={v.id}><span>{fullName(v.student)} · {personType(v.personType)} · {v.visitDay} · In {clock(v.timeIn)} · {v.status}</span>{v.status === "Individual review required" && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setNotice(""); setReviewVisit(v); setCorrectionClock(""); }}>Review Time Out</Button>}</li>)}</ul></section>}
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Attendance History</h2><Button variant="outline" onClick={() => void exportCsv()} disabled={!data}><Download />Export CSV</Button></div>
      <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setHistorySearch(search); setPageNumber(1); }}>
        <label className="flex flex-col gap-1 text-sm">Period<select aria-label="Period" className={selectClass} value={period} onChange={e => { setPeriod(e.target.value as LibraryPeriod); setPageNumber(1); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="flex flex-col gap-1 text-sm">Entry date<Input type="date" value={date} onChange={e => { setDate(e.target.value); setPageNumber(1); }} required /></label>
        <label className="flex flex-col gap-1 text-sm">Visitor type<select aria-label="Visitor type" className={selectClass} value={type} onChange={e => { setType(e.target.value); setPageNumber(1); }}><option value="ALL">All visitors</option><option value="STUDENT">Students only</option><option value="EMPLOYEE">Employees only</option></select></label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">Search name or ID<Input value={search} onChange={e => setSearch(e.target.value)} maxLength={100} placeholder="Name or visitor ID" /></label><Button type="submit" variant="outline">Search history</Button>
      </form>
      <p className="mb-3 text-sm text-slate-500">{data?.range.start} – {data?.range.end} · {data?.total ?? 0} visits · Asia/Manila{isFetching ? " · Updating…" : ""}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50"><tr>{["Name", "Type", "Date", "Time In", "Time Out", "Status"].map(c => <th className="whitespace-nowrap px-3 py-3" key={c}>{c}</th>)}</tr></thead><tbody>{data?.visits.map(v => <tr className="border-b border-slate-100" key={v.id}><td className="px-3 py-3 font-medium">{fullName(v.student)}<span className="block text-xs font-normal text-slate-500">{v.studentId}</span></td><td className={`px-3 py-3 ${v.personType === "EMPLOYEE" ? "font-medium text-violet-700" : ""}`}>{personType(v.personType)}</td><td className="whitespace-nowrap px-3 py-3">{v.visitDay}</td><td className="whitespace-nowrap px-3 py-3">{clock(v.timeIn)}</td><td className="whitespace-nowrap px-3 py-3">{clock(v.timeOut)}</td><td className="px-3 py-3">{v.status}{v.isDemo && <span className="block text-xs font-semibold text-amber-700">SIMULATED</span>}{v.administrativelyClosedAt && <span className="block text-xs text-slate-500">Corrected {formatReportDateTime(v.administrativelyClosedAt)}</span>}</td></tr>)}</tbody></table></div>
      {data?.visits.length === 0 && <p className="py-6 text-center text-slate-500">No visits match these filters.</p>}
      <div className="mt-4 flex items-center justify-end gap-3"><Button variant="outline" disabled={pageNumber <= 1 || isFetching} onClick={() => setPageNumber(v => v - 1)}>Previous</Button><span className="text-sm">Page {pageNumber}</span><Button variant="outline" disabled={!data || pageNumber * 50 >= data.total || isFetching} onClick={() => setPageNumber(v => v + 1)}>Next</Button></div>
    </section>
    <Dialog open={manual} onOpenChange={setManual}><DialogContent><DialogHeader><DialogTitle>Manual Search</DialogTitle><DialogDescription>Find an existing student or employee. Record scan uses the same automatic Time In / Time Out toggle.</DialogDescription></DialogHeader><form onSubmit={lookupPeople} className="flex gap-2"><Input aria-label="Find visitor by name or ID" value={lookup} onChange={e => setLookup(e.target.value)} maxLength={100} required /><Button type="submit" disabled={pending}>Find</Button></form>{notice && <p role="alert">{notice}</p>}<ul className="max-h-80 overflow-y-auto divide-y">{people.map(p => <li className="space-y-2 py-3" key={p.id}><p className="font-medium">{fullName(p)} · {personType(p.personType)}</p><p className="text-sm text-slate-500">{p.id}</p><div className="flex flex-wrap gap-2"><Button disabled={pending || !!feedback} onClick={() => void recordScan(p.id)}>Record scan</Button><Button variant="outline" onClick={() => { setQrPerson(p); setManual(false); }}>View QR</Button>{user?.role === "ADMIN" && p.personType !== "EMPLOYEE" && <Button variant="outline" onClick={() => setClassifyPerson(p)}>Classify as Employee</Button>}</div></li>)}</ul>{lookupDone && !people.length && <p>No matching visitors. Ask an administrator to register new employees.</p>}</DialogContent></Dialog>
    <Dialog open={employeeForm} onOpenChange={setEmployeeForm}><DialogContent><DialogHeader><DialogTitle>Register Employee</DialogTitle><DialogDescription>Use a unique 11-character ID. If this person already has a directory record, use Manual Search to classify that identity.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={saveEmployee}>{[["id", "Employee ID"], ["firstName", "First name"], ["lastName", "Last name"], ["middleName", "Middle name (optional)"]].map(([name, label]) => <label className="flex flex-col gap-1 text-sm" key={name}>{label}<Input name={name} required={name !== "middleName"} minLength={name === "id" ? 11 : undefined} maxLength={name === "id" ? 11 : 100} /></label>)}{notice && <p role="alert">{notice}</p>}<Button type="submit" disabled={pending}>Save Employee</Button></form></DialogContent></Dialog>
    <Dialog open={!!classifyPerson} onOpenChange={open => { if (!open) setClassifyPerson(null); }}><DialogContent><DialogHeader><DialogTitle>Classify existing identity as Employee?</DialogTitle><DialogDescription>{classifyPerson && fullName(classifyPerson)} ({classifyPerson?.id}) will be connected to Employees and excluded from ordinary event audiences. Earlier library visit classifications are preserved.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setClassifyPerson(null)}>Cancel</Button><Button disabled={pending} onClick={() => void classifyEmployee()}>Confirm classification</Button></div>{notice && <p role="alert">{notice}</p>}</DialogContent></Dialog>
    <Dialog open={closeDialog || !!reviewVisit} onOpenChange={open => { if (!open) { setCloseDialog(false); setReviewVisit(null); } }}><DialogContent><DialogHeader><DialogTitle>{reviewVisit ? "Review forgotten Time Out" : `Close ${data?.summary.bulkEligible ?? 0} forgotten visits?`}</DialogTitle><DialogDescription>{reviewVisit ? `${fullName(reviewVisit.student)} entered ${reviewVisit.visitDay} at ${clock(reviewVisit.timeIn)}. Enter a valid observed or confirmed Time Out in Asia/Manila. It will be marked as closed by librarian.` : "These visits will receive a Time Out of 5:00 PM on their corresponding dates. This action will update attendance records. After-hours entries are excluded. The server rechecks eligibility when you confirm."}</DialogDescription></DialogHeader>{reviewVisit && <label className="space-y-1 text-sm">Time Out (Asia/Manila)<Input type="datetime-local" value={correctionClock} onChange={e => setCorrectionClock(e.target.value)} min={formatReportDateTime(reviewVisit.timeIn).slice(0, 16).replace(" ", "T")} max={formatReportDateTime(new Date()).slice(0, 16).replace(" ", "T")} /></label>}{notice && <p role="alert">{notice}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setCloseDialog(false); setReviewVisit(null); }}>Cancel</Button><Button disabled={pending || (!!reviewVisit && !correctionClock)} onClick={() => void closeVisits()}>Confirm Close</Button></div></DialogContent></Dialog>
    <Dialog open={!!qrPerson} onOpenChange={open => { if (!open) setQrPerson(null); }}><DialogContent><DialogHeader><DialogTitle>Visitor QR Code</DialogTitle><DialogDescription>Use this existing identity QR for Library Attendance.</DialogDescription></DialogHeader>{qrPerson && <StudentQRCard student={qrPerson} showGroupDetail={false} fillHeight={false} />}<Button onClick={() => window.print()}>Print QR</Button></DialogContent></Dialog>
    {qrPerson && <div className="student-qr-center"><StudentQRPrintGrid students={[{ ...qrPerson, program: undefined, strand: undefined, department: undefined, house: undefined, section: undefined }]} size="standard" /></div>}
  </div></section>;
}
