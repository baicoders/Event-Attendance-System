"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError } from "@/globals/utils/api";
import { toastSuccess, toastWarning } from "@/globals/components/shared/toasts";
import { useAuth } from "@/globals/contexts/AuthContext";
import { page } from "@/globals/constants/designTokens";
import { hasAmbiguousStudentGroups } from "@/globals/utils/studentGroupReview";
import { safeStudentReturnHref } from "@/globals/utils/studentReturn";
import type { StudentDetail } from "@/globals/types/students";
import type { StudentFormValues } from "@/globals/schemas/studentSchema";
import StudentFormDrawer from "./StudentFormDrawer";
import { StudentQRCard } from "./StudentQRCard";
import { StudentQrModal } from "./StudentQRModal";
import { StudentAttendanceHistoryPanel } from "./StudentAttendanceHistoryPanel";
import { useEditStudentDetail, useStudentDetail } from "../hooks/useStudentDetail";

const dateFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
const groupLabels: Record<string, string> = {
  SECTION: "Section", HOUSE: "House", DEPARTMENT: "Department", PROGRAM: "Program", STRAND: "Strand",
};

export default function StudentDetailClient({ studentId }: { studentId: string }) {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const query = useStudentDetail(studentId);
  const edit = useEditStudentDetail(studentId);
  const [snapshot, setSnapshot] = useState<StudentDetail>();
  const [editorKey, setEditorKey] = useState(0);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [canReloadEditor, setCanReloadEditor] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const backHref = safeStudentReturnHref(searchParams.get("returnTo"));
  const tab = searchParams.get("tab") === "attendance" ? "attendance" : "overview";
  const student = user?.status === "ACTIVE" && !(query.error instanceof ApiError && [401, 403].includes(query.error.status)) &&
    !(query.error instanceof ApiError && query.error.status === 404 && !snapshot) && query.data?.id === studentId
    ? query.data : undefined;
  const ambiguous = student ? hasAmbiguousStudentGroups(student.groups ?? []) : false;
  const tabHref = (next: "overview" | "attendance") => {
    const params = new URLSearchParams();
    if (backHref !== "/students") params.set("returnTo", backHref);
    if (next === "attendance") params.set("tab", "attendance");
    return `/students/${encodeURIComponent(studentId)}${params.size ? `?${params}` : ""}`;
  };

  const openEditor = () => {
    if (!student || query.isFetching || query.isError || ambiguous) return;
    setSnapshot(student);
    setEditorKey(key => key + 1);
    setEditorError(null);
    setCanReloadEditor(false);
  };
  const save = async (values: StudentFormValues) => {
    if (!snapshot) return;
    setEditorError(null);
    try {
      const saved = await edit.mutateAsync({ expectedVersion: snapshot.editVersion, student: { ...values, id: snapshot.id } });
      if (saved.changed) toastSuccess("Student changes saved");
      else toastWarning("No student changes to save");
      setSnapshot(undefined);
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        await query.refetch();
      }
      if (error instanceof ApiError && error.code === "STUDENT_EDIT_CONFLICT") {
        setEditorError("This student changed after you opened the form. Your unsaved entries are still here. Reload the current record before saving.");
        setCanReloadEditor(true);
      } else if (error instanceof ApiError && error.code === "STUDENT_GROUP_REVIEW_REQUIRED") {
        setEditorError(error.message);
      } else if (error instanceof ApiError && error.status === 404) {
        setEditorError("This student was deleted while you were editing. Your unsaved entries remain here until you close the form.");
      } else {
        setEditorError("The save outcome is unknown. Keep these entries and reload the current record before trying again. " + (error instanceof Error ? error.message : ""));
        setCanReloadEditor(true);
      }
    }
  };
  const reloadEditor = async () => {
    const refreshed = await query.refetch();
    if (refreshed.data?.id === studentId) {
      setSnapshot(refreshed.data);
      setEditorKey(key => key + 1);
      setEditorError(null);
      setCanReloadEditor(false);
    }
  };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(studentId);
      setCopyMessage("Student ID copied.");
    } catch {
      setCopyMessage("Clipboard unavailable. Select and copy the Student ID above.");
    }
  };

  return <section className={`${page.surface} min-h-svh`}>
    <div className={`${page.containerWide} mx-auto px-4 py-6 sm:px-6`}>
      <Link href={backHref} className="w-fit text-sm font-medium text-indigo-700 underline">← Back to students</Link>
      {!user || user.status !== "ACTIVE" ? <p role="status">Checking access…</p> : query.isLoading ?
        <p role="status">Loading student record…</p> : query.isError && !student ?
        <div role="alert" className="rounded-xl border bg-white p-6">
          <h1 className="text-xl font-semibold">{query.error instanceof ApiError && query.error.status === 404 ? "Student not found" :
            query.error instanceof ApiError && [401, 403].includes(query.error.status) ? "Student record unavailable" : "Could not load student record"}</h1>
          <p className="mt-2 text-sm text-slate-600">{query.error.message}</p>
          <button type="button" className="mt-4 rounded border px-4 py-2" onClick={() => void query.refetch()}>Retry</button>
        </div> : student ? <>
          <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-700">Student record</p>
                <h1 className="mt-2 break-words text-2xl font-bold text-slate-900 sm:text-3xl">{[student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")}</h1>
                <p className="mt-2 break-all text-sm">Student ID: <span className="select-text font-semibold">{student.id}</span></p>
                <button type="button" className="mt-2 text-sm text-indigo-700 underline" onClick={() => void copyId()}>Copy student ID</button>
                {copyMessage && <p role="status" className="mt-1 text-xs text-slate-600">{copyMessage}</p>}
              </div>
              <button type="button" className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={query.isFetching || query.isError || ambiguous}
                onClick={openEditor}>Edit student</button>
            </div>
            <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">First name</dt><dd className="break-words">{student.firstName}</dd></div>
              <div><dt className="text-slate-500">Middle name</dt><dd className="break-words">{student.middleName || "Not provided"}</dd></div>
              <div><dt className="text-slate-500">Last name</dt><dd className="break-words">{student.lastName}</dd></div>
            </dl>
          </header>
          {query.isError && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Showing previously loaded student data from {dateFormat.format(student.updatedAt)}. Refresh before editing.</p>}
          <nav aria-label="Student sections" className="flex flex-wrap gap-2">
            <Link href={tabHref("overview")} aria-current={tab === "overview" ? "page" : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "overview" ? "bg-indigo-700 text-white" : "border bg-white"}`}>Overview</Link>
            <Link href={tabHref("attendance")} aria-current={tab === "attendance" ? "page" : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "attendance" ? "bg-indigo-700 text-white" : "border bg-white"}`}>Attendance history</Link>
          </nav>
          {tab === "overview" ? <>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section className="min-w-0 rounded-2xl border bg-white p-5" aria-label="Current academic information">
                <h2 className="text-lg font-semibold">Current academic information</h2>
                <p className="mt-3 text-sm"><strong>School level:</strong> {student.schoolLevel === "SHS" ? "Senior High School" : "College"}</p>
                <p className="mt-1 text-sm"><strong>{student.schoolLevel === "SHS" ? "Grade" : "Year"}:</strong> {student.yearLevel.replace("_", " ")}</p>
                {ambiguous && <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Group assignments require review. All current memberships are shown below; profile editing is unavailable until they are resolved.</p>}
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(student.schoolLevel === "SHS" ? ["STRAND", "SECTION", "HOUSE"] : ["DEPARTMENT", "PROGRAM", "SECTION", "HOUSE"]).map(category => {
                    const groups = (student.groups ?? []).filter(group => group.category === category);
                    return <div key={category}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{groupLabels[category]}</dt>
                      <dd className="break-words text-sm">{groups.length ? groups.map(group => <span key={group.id} className="block">{group.name} <span className="text-xs text-slate-500">({group.slug})</span></span>) : "Not assigned"}</dd></div>;
                  })}
                  {(student.groups ?? []).filter(group => !groupLabels[group.category] ||
                    (student.schoolLevel === "SHS" ? ["DEPARTMENT", "PROGRAM"].includes(group.category) : group.category === "STRAND"))
                    .map(group => <div key={group.id}><dt className="text-xs font-semibold uppercase text-amber-700">Additional {group.category.toLowerCase()}</dt><dd className="break-words text-sm">{group.name} ({group.slug})</dd></div>)}
                </dl>
              </section>
              <section className="rounded-2xl border bg-white p-5" aria-label="Student QR">
                <h2 className="mb-3 text-lg font-semibold">Student QR</h2>
                <StudentQRCard student={student} showGroupDetail={!ambiguous} />
                <button type="button" className="mt-3 text-sm text-indigo-700 underline" onClick={() => setQrOpen(true)}>View larger QR</button>
              </section>
            </div>
            <section className="rounded-2xl border bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Recent recorded events · last 90 days</h2>
                <Link href={tabHref("attendance")} className="text-sm text-indigo-700 underline">View attendance history</Link></div>
              <StudentAttendanceHistoryPanel key={studentId} studentId={studentId} variant="recent" />
            </section>
          </> : <section className="min-w-0 rounded-2xl border bg-white p-5">
            <h2 className="mb-4 text-lg font-semibold">Attendance history</h2>
            <StudentAttendanceHistoryPanel key={studentId} studentId={studentId} />
          </section>}
          <footer className="text-xs text-slate-600">Current roster record · Record created {dateFormat.format(student.createdAt)} · Last updated {dateFormat.format(student.updatedAt)} · Asia/Manila. Changing school or group assignments can change current-roster reports.</footer>
          <StudentQrModal open={qrOpen} onOpenChange={setQrOpen} student={student} showGroupDetail={!ambiguous} />
          <StudentFormDrawer key={`${studentId}-${editorKey}`} student={snapshot} isOpen={!!snapshot}
            onViewQR={() => setQrOpen(true)} onClose={() => setSnapshot(undefined)} onSubmit={save}
            saveError={editorError} onReloadCurrent={canReloadEditor ? () => void reloadEditor() : undefined} />
        </> : null}
    </div>
  </section>;
}
