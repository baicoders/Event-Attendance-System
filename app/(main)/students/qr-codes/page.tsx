"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Printer, QrCode } from "lucide-react";
import { useFetchStudents } from "@/globals/hooks/useStudents";
import { page } from "@/globals/constants/designTokens";
import type { QRIdentifierType } from "@/features/students/utils/qrIdentifier";
import { StudentQRCard } from "@/features/students/components/StudentQRCard";
import { StudentQRPrintGrid } from "@/features/students/components/StudentQRPrintGrid";
import { StudentQrModal } from "@/features/students/components/StudentQRModal";
import { Student } from "@/globals/types/students";
import { useCustomGroups } from "@/features/custom-groups/hooks/useCustomGroups";
import getDynamicFilters from "@/features/students/utils/getDynamicFilters";
import { filterQRStudents, getRosterContext, QR_FILTER_FIELDS, QRFilterField, QRPrintScope, studentsForPrint } from "@/features/students/utils/qrScope";

const PREVIEW_PAGE_SIZE = 48;
const EMPTY_STUDENTS: Student[] = [];
const GROUP_FIELDS: Record<string, QRFilterField> = { DEPARTMENT: "department", PROGRAM: "program", STRAND: "strand", HOUSE: "house", SECTION: "section" };
const FIELD_LABELS: Record<QRFilterField, string> = { schoolLevel: "School level", yearLevel: "Year / grade", department: "Department", program: "Program", strand: "Strand", house: "House", section: "Section" };

export default function StudentQRCenterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const context = getRosterContext(searchParams);
  const customGroupId = context.filters.customGroupId || "";
  const customGroups = useCustomGroups();
  const customGroup = customGroups.data?.find((group) => group.id === customGroupId);
  const contextKey = `${context.category}:${context.item || "General"}${customGroupId ? `:custom:${customGroupId}` : ""}`;
  const { data, isLoading, isError } = useFetchStudents(context.filters);
  const students = data ?? EMPTY_STUDENTS;
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [filters, setFilters] = useState<Partial<Record<QRFilterField, string>>>(() => Object.fromEntries(QR_FILTER_FIELDS.map((field) => [field, searchParams.get(`filter_${field}`) || ""])));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<QRPrintScope>(searchParams.get("scope") === "selected" ? "selected" : "filtered");
  const [identifierType, setIdentifierType] = useState<QRIdentifierType>("USN");
  const [size, setSize] = useState<"standard" | "large">("standard");
  const [pageIndex, setPageIndex] = useState(0);
  const [previewSelectedOnly, setPreviewSelectedOnly] = useState(false);
  const [modalStudent, setModalStudent] = useState<Student>();

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("student-qr-selection") || "null");
      if (searchParams.get("scope") === "selected" && saved?.context === contextKey && Array.isArray(saved.ids)) setSelectedIds(new Set(saved.ids.filter((id: unknown) => typeof id === "string")));
    } catch { /* Bad saved state does not block QR management. */ }
  }, [contextKey, searchParams]);

  const filtered = useMemo(() => filterQRStudents(students, search, filters), [students, search, filters]);
  const studentIds = useMemo(() => new Set(students.map((student) => student.id)), [students]);
  const selectedCount = [...selectedIds].filter((id) => studentIds.has(id)).length;
  const printStudents = useMemo(() => studentsForPrint(students, filtered, selectedIds, scope), [students, filtered, selectedIds, scope]);
  const previewResults = previewSelectedOnly ? students.filter((student) => selectedIds.has(student.id)) : filtered;
  const pageCount = Math.max(1, Math.ceil(previewResults.length / PREVIEW_PAGE_SIZE));
  const previewStudents = previewResults.slice(pageIndex * PREVIEW_PAGE_SIZE, (pageIndex + 1) * PREVIEW_PAGE_SIZE);
  const options = useMemo(() => getDynamicFilters(students), [students]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((student) => selectedIds.has(student.id));
  const backParams = new URLSearchParams(context.filters).toString();
  const backHref = searchParams.get("source") === "custom-group"
    ? customGroupId ? `/custom-groups/${encodeURIComponent(customGroupId)}` : "/custom-groups"
    : searchParams.get("source") === "directory" ? "/students" : `/students/student-list?${backParams}`;

  const setCustomGroup = (groupId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (groupId) params.set("customGroupId", groupId); else params.delete("customGroupId");
    params.delete("scope");
    params.delete("search");
    QR_FILTER_FIELDS.forEach((field) => params.delete(`filter_${field}`));
    setSearch("");
    setFilters({});
    setSelectedIds(new Set());
    setScope("filtered");
    setPreviewSelectedOnly(false);
    setPageIndex(0);
    setModalStudent(undefined);
    router.replace(`/students/qr-codes?${params}`, { scroll: false });
  };

  const toggleSelected = (id: string) => {
    setScope("selected");
    setPageIndex(0);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllFiltered = () => {
    setScope("selected");
    setPageIndex(0);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      filtered.forEach((student) => { if (allFilteredSelected) next.delete(student.id); else next.add(student.id); });
      return next;
    });
  };
  const setFilter = (field: QRFilterField, value: string) => {
    setFilters((previous) => ({ ...previous, [field]: value }));
    setPageIndex(0);
  };
  const print = () => {
    if (printStudents.length) window.print();
  };

  return (
    <section className={`${page.surface} min-h-svh student-qr-center`}>
      <style>{"@media print { @page { size: A4 portrait; margin: 10mm; } }"}</style>
      <div className={`${page.containerWide} no-print space-y-5`}>
        <Link href={backHref} className="inline-flex rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:border-indigo-300">← {searchParams.get("source") === "custom-group" ? "Back to Custom Group" : "Back to Students"}</Link>
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">{customGroup?.name || context.label}{context.item ? ` • ${context.item}` : ""}</p>
              <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-slate-900"><QrCode className="size-7" /> Student QR Codes</h1>
              <p className="mt-2 text-sm text-slate-600">{students.length} {customGroupId ? "members in this group roster" : "students in this roster"}. Review cards and choose exactly what to print.</p>
            </div>
            <button type="button" onClick={print} disabled={isLoading || isError || !printStudents.length} className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"><Printer className="size-4" /> Print QR Codes ({printStudents.length})</button>
          </div>
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold text-slate-600" htmlFor="qr-custom-group">Custom group
              <select id="qr-custom-group" value={customGroupId} onChange={(event) => setCustomGroup(event.target.value)} disabled={customGroups.isLoading || customGroups.isError} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 disabled:opacity-50">
                <option value="">All students</option>
                {customGroupId && !customGroup && <option value={customGroupId}>{customGroups.isLoading ? "Loading group…" : "Selected group"}</option>}
                {customGroups.data?.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.memberCount})</option>)}
              </select>
            </label>
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">Search students<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPageIndex(0); }} placeholder="Name, USN, LRN, program, section..." className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
            {QR_FILTER_FIELDS.map((field) => {
              const key = field === "schoolLevel" || field === "yearLevel" ? field : Object.keys(GROUP_FIELDS).find((group) => GROUP_FIELDS[group] === field);
              const choices = options[key || ""] || [];
              if (choices.length < 2) return null;
              return <label key={field} className="flex min-w-36 flex-col gap-1 text-xs font-semibold text-slate-600">{FIELD_LABELS[field]}<select value={filters[field] || ""} onChange={(event) => setFilter(field, event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"><option value="">All</option>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>;
            })}
          </div>
          {customGroups.isError && <p role="alert" className="mt-3 text-sm text-rose-700">Couldn&apos;t load custom groups. <button type="button" onClick={() => customGroups.refetch()} className="underline">Retry</button></p>}
        </header>

        <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1fr_auto_auto]">
          <fieldset><legend className="mb-2 text-sm font-semibold text-slate-900">Print scope</legend><div className="flex flex-wrap gap-4 text-sm text-slate-700">
            {([ ["selected", `Selected students (${selectedCount})`], ["filtered", `Current filtered results (${filtered.length})`], ["roster", `${customGroupId ? "Entire group roster" : "Entire roster"} (${students.length})`] ] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="qr-scope" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}
          </div></fieldset>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">Preferred QR identifier
            <select value={identifierType} onChange={event => setIdentifierType(event.target.value as QRIdentifierType)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              <option value="USN">USN</option><option value="LRN">LRN</option>
            </select>
            <span className="max-w-64 text-xs font-normal text-slate-500">Uses the other identifier when unavailable. Each card shows the identifier encoded.</span>
          </label>
          <fieldset><legend className="mb-2 text-sm font-semibold text-slate-900">Card size</legend><div className="flex gap-4 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="radio" name="qr-size" checked={size === "standard"} onChange={() => setSize("standard")} />Standard · 12/page</label><label className="flex items-center gap-2"><input type="radio" name="qr-size" checked={size === "large"} onChange={() => setSize("large")} />Large · 6/page</label></div></fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={!filtered.length} /> Select all filtered students ({filtered.length})</label><label className="flex items-center gap-2"><input type="checkbox" checked={previewSelectedOnly} onChange={(event) => { setPreviewSelectedOnly(event.target.checked); setPageIndex(0); }} /> Show selected only ({selectedCount})</label><span>{selectedCount} selected across all preview pages</span></div>
        {isLoading ? <p className="rounded-xl bg-white p-8">Loading students…</p> : isError ? <p className="rounded-xl bg-white p-8 text-rose-700">Couldn&apos;t load students. Please retry.</p> : !previewResults.length ? <p className="rounded-xl bg-white p-8">{previewSelectedOnly ? "No students selected." : "No students match the current search and filters."}</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{previewStudents.map((student) => <div key={student.id} className="relative rounded-xl bg-white p-3 shadow-sm"><label className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={selectedIds.has(student.id)} onChange={() => toggleSelected(student.id)} /> Select</label><button type="button" onClick={() => setModalStudent(student)} className="block w-full text-left" aria-label={`View QR for ${student.id}`}><StudentQRCard student={student} identifierType={identifierType} /></button></div>)}</div>}
        {pageCount > 1 && <div className="flex items-center justify-center gap-4 pb-6 text-sm"><button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)} className="rounded-full border bg-white px-4 py-2 disabled:opacity-40">Previous</button><span>Page {pageIndex + 1} of {pageCount}</span><button type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex(pageIndex + 1)} className="rounded-full border bg-white px-4 py-2 disabled:opacity-40">Next</button></div>}
      </div>

      <StudentQRPrintGrid students={printStudents} size={size} identifierType={identifierType} />
      <StudentQrModal open={!!modalStudent} onOpenChange={(open) => { if (!open) setModalStudent(undefined); }} student={modalStudent} identifierType={identifierType} onIdentifierTypeChange={setIdentifierType} />
    </section>
  );
}
