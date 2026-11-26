'use client';
import { History } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { formatReportDateTime } from '@/globals/utils/reportTime';
import { Feedback, LoadingState, SectionPanel } from './ui';
type Change = { id: string; source: string; reason: string | null; actorName: string; actorId: string | null; createdAt: string; toRevision: number; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
const fieldNames: Record<string, string> = { firstName: 'First name', lastName: 'Last name', middleName: 'Middle name', usn: 'USN', lrn: 'LRN', schoolLevel: 'School level', yearLevel: 'Year level', groups: 'Official groups', section: 'Official section', department: 'Department', program: 'Program', strand: 'Strand' };
export default function StudentChangeTimeline({ studentId }: { studentId: string }) {
  return <StudentHistory key={studentId} studentId={studentId} />;
}
function StudentHistory({ studentId }: { studentId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const changes = useQuery({ queryKey: ['classroom', 'student-history', studentId, user?.id, user?.role, user?.classroomStatus, user?.credentialVersion, cursor], enabled: !!user && open, queryFn: ({ signal }) => fetchApi<{ items: Change[]; total: number; nextCursor: string | null }>('/api/classroom/students/' + encodeURIComponent(studentId) + '/changes?' + new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) }), { signal }), staleTime: 0 });
  return <SectionPanel contentClassName="p-0 sm:p-0"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary className="min-h-12 cursor-pointer p-5 font-semibold text-slate-900"><History aria-hidden className="mr-2 inline size-5 text-indigo-600"/>Change history</summary>{open ? <>
    {changes.isPending ? <LoadingState label="Loading history…" /> : changes.isError ? <div className="p-5"><Feedback title="Unable to load profile history" onRetry={() => void changes.refetch()} /></div> : !changes.data?.items.length ? <p className="p-5 text-sm text-slate-500">No profile changes have been recorded.</p> : <>
      <ol className="divide-y divide-slate-100">{changes.data.items.map(change => <li key={change.id} className="space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="break-words text-sm font-semibold text-slate-900">{change.before ? 'Student details updated' : 'Student record added'}</p></div><p className="text-xs text-slate-500">{formatReportDateTime(change.createdAt)} · Asia/Manila</p><p className="text-sm text-slate-600">{!['BASELINE', 'SYSTEM'].includes(change.source) && change.actorName && !/unattributed|database writer|^system$/i.test(change.actorName) ? 'Recorded by ' + change.actorName : 'School record'}</p>{change.reason ? <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{change.reason}</p> : null}
        <details><summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-indigo-700">View changes</summary><dl className="space-y-3">{[...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])].filter(key => fieldNames[key] && JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key])).map(key => <div key={key} className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]"><dt className="font-medium text-slate-600">{fieldNames[key]}</dt><dd className="whitespace-pre-wrap break-words">{display(change.before?.[key])} → {display(change.after?.[key])}</dd></div>)}</dl></details>
        <details><summary className="min-h-12 cursor-pointer py-3 text-xs font-medium text-slate-500">Advanced record details</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-xs">{JSON.stringify({ version: change.toRevision, source: change.source, before: change.before, after: change.after }, null, 2)}</pre></details>
      </li>)}</ol>
      {(changes.data.nextCursor || cursors.length > 0) ? <nav aria-label="Profile history pages" className="flex flex-wrap items-center justify-end gap-3 border-t p-4"><Button variant="outline" disabled={!cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</Button><span className="text-sm text-slate-500">Page {cursors.length + 1}</span><Button variant="outline" disabled={!changes.data.nextCursor} onClick={() => setCursors(values => [...values, changes.data!.nextCursor!])}>Next</Button></nav> : null}
    </>}
  </> : null}</details></SectionPanel>;
}
function display(value: unknown): string { if (value === undefined || value === null || value === '') return 'Not set'; if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item && 'name' in item ? String(item.name) : JSON.stringify(item)).join(', ') || 'None'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
