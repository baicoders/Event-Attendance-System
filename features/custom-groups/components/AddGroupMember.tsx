"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import FormInput from "@/globals/components/shared/FormInput";
import { toastSuccess } from "@/globals/components/shared/toasts";
import { focusRing, surface, type as typeToken } from "@/globals/constants/designTokens";
import { useChangeMembership, useSearchGroupStudents } from "../hooks/useCustomGroups";
import { studentName, type StudentSearchResult } from "../types";

export default function AddGroupMember({ groupId }: { groupId: string }) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [position, setPosition] = useState("");
  const [error, setError] = useState<string>();
  const students = useSearchGroupStudents(debouncedSearch);
  const membership = useChangeMembership(groupId);
  const searching = search.trim() !== debouncedSearch || students.isFetching;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || membership.isPending) return;
    setError(undefined);
    try {
      await membership.mutateAsync({ action: "add", studentId: selected.id, position: position.trim() || null });
      toastSuccess("Member added", studentName(selected));
      setSelected(null);
      setPosition("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't add this student. Please retry.");
    }
  }

  return (
    <section className={`${surface.panel} p-5 md:p-6`} aria-labelledby={`${searchId}-heading`}>
      <h2 id={`${searchId}-heading`} className={typeToken.sectionTitle}>Add existing student</h2>
      <p className="mt-1 text-sm text-slate-500">Search by name, USN, or LRN. A student can belong to one custom group.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <FormInput id={searchId} label="Find student" type="search" value={search} disabled={membership.isPending} placeholder="Name, USN, or LRN" autoComplete="off" onChange={(event) => { setSearch(event.target.value); setSelected(null); setError(undefined); }} />
        <div aria-live="polite" aria-busy={searching}>
          {!search.trim() ? <p className="text-sm text-slate-500">Enter a name or identifier to find students.</p>
            : searching ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 aria-hidden className="size-4 animate-spin" />Searching students…</p>
            : students.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-600"><p>{students.error instanceof Error ? students.error.message : "Couldn't search students."}</p><Button type="button" variant="outline" size="sm" onClick={() => students.refetch()}>Retry search</Button></div>
            : !students.data?.length ? <p className="text-sm text-slate-500">No students match this search.</p>
            : <fieldset disabled={membership.isPending}>
              <legend className="mb-2 text-xs text-slate-500">Select a student. Showing up to 30 results; refine your search if needed.</legend>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {students.data.map((student) => {
                  const unavailable = Boolean(student.customGroupId);
                  return (
                    <label key={student.id} className={`flex items-start gap-3 px-4 py-3 ${unavailable ? "bg-slate-50 text-slate-500" : "cursor-pointer hover:bg-indigo-50/50"}`}>
                      <input className={`mt-1 accent-indigo-600 ${focusRing}`} type="radio" name={`${searchId}-student`} value={student.id} checked={selected?.id === student.id} disabled={unavailable} onChange={() => { setSelected(student); setError(undefined); }} />
                      <span className="min-w-0 text-sm">
                        <span className="block break-words font-medium">{studentName(student)}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">USN: {student.usn || "—"} · LRN: {student.lrn || "—"}</span>
                        {unavailable && <span className="mt-1 block text-xs">{student.customGroupId === groupId ? "Already a member of this group" : `Member of ${student.customGroupName ?? "another custom group"}`}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>}
        </div>
        {selected && <div className="space-y-3 rounded-xl bg-indigo-50/60 p-4">
          <p className="text-sm font-medium text-slate-700">Selected: {studentName(selected)}</p>
          <FormInput id={`${searchId}-position`} label="Position (optional)" value={position} maxLength={160} disabled={membership.isPending} onChange={(event) => { setPosition(event.target.value); setError(undefined); }} placeholder="e.g. President, Member" description="Free text. Leave blank if this student has no position." />
        </div>}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <Button type="submit" disabled={!selected || searching || membership.isPending}>
          {membership.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserPlus aria-hidden className="size-4" />}
          {membership.isPending ? "Adding…" : "Add member"}
        </Button>
      </form>
    </section>
  );
}
