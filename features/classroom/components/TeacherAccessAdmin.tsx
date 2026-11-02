'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/globals/components/shad-cn/sheet';
import StatusBadge from '@/globals/components/shared/StatusBadge';
import type { TeacherApplicationDto } from '../types/application';
type Teacher = TeacherApplicationDto & { user: { id: string; name: string; email: string } };
type Action = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REVOKE' | 'RESTORE';
const confirmations = { APPROVE: 'Confirm approval', REJECT: 'Confirm rejection', SUSPEND: 'Confirm suspension', REVOKE: 'Confirm revocation', RESTORE: 'Confirm restoration' };
const labels = { APPROVE: 'Approve', REJECT: 'Reject', SUSPEND: 'Suspend Class access', REVOKE: 'Revoke Class access', RESTORE: 'Restore Class access' };
export default function TeacherAccessAdmin() {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<{ teacher: Teacher; action: Action; commandId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const teachers = useQuery({ queryKey: ['classroom', 'admin', 'teachers', status, page], queryFn: () => fetchApi<{ items: Teacher[]; total: number }>('/api/admin/classroom/teachers?' + new URLSearchParams({ ...(status ? { status } : {}), page: String(page), pageSize: '100' })) });
  const choose = (teacher: Teacher, action: Action) => { setSelection({ teacher, action, commandId: crypto.randomUUID() }); setReason(''); setError(''); };
  return <div className="space-y-5">
    <label className="block text-sm font-medium">Teacher access status<select aria-label="Teacher access status" className="ml-2 min-h-12 rounded-xl border border-slate-300 bg-white px-3" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
      <option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'].map(value => <option key={value} value={value}>{value.toLowerCase()}</option>)}
    </select></label>
    <Button className="min-h-12" variant="outline" onClick={() => void teachers.refetch()}>Refresh applications</Button>
    {teachers.isLoading ? <p>Loading teachers…</p> : teachers.isError ? <div role="alert"><p>Unable to load teacher applications.</p><Button className="min-h-12" onClick={() => void teachers.refetch()}>Retry</Button></div> : !teachers.data?.items.length ? <p className="rounded-2xl border border-slate-200 bg-white p-6">No teacher applications match this status.</p> : teachers.data.items.map(teacher => <article key={teacher.userId} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-words font-semibold">{teacher.user.name}</h2><StatusBadge tone={teacher.status === 'APPROVED' ? 'success' : teacher.status === 'PENDING' ? 'info' : 'warning'}>{teacher.status.toLowerCase()}</StatusBadge></div>
      <p className="break-words text-sm text-slate-600">{teacher.user.email}</p><Link className="flex min-h-12 items-center text-indigo-700 underline" href={'/class/admin/teachers/'+encodeURIComponent(teacher.userId)}>Review teacher details and history</Link><p className="text-sm">{teacher.departmentOrDesignation}</p>{teacher.staffReference ? <p className="break-words text-sm text-slate-600">Staff reference: {teacher.staffReference}</p> : null}
      {teacher.applicationText ? <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{teacher.applicationText}</p> : null}
      {teacher.decisionReason ? <p className="whitespace-pre-wrap break-words text-sm text-slate-600">Reason: {teacher.decisionReason}</p> : null}
      <div className="flex flex-wrap gap-2">{(teacher.status === 'PENDING' ? ['APPROVE', 'REJECT'] : teacher.status === 'APPROVED' ? ['SUSPEND', 'REVOKE'] : teacher.status === 'SUSPENDED' ? ['RESTORE', 'REVOKE'] : teacher.status === 'REVOKED' ? ['RESTORE'] : []).map(action => <Button className="min-h-12" key={action} variant={action === 'APPROVE' || action === 'RESTORE' ? 'default' : 'outline'} onClick={() => choose(teacher, action as Action)}>{labels[action as Action]}</Button>)}</div>
    </article>)}
    {teachers.data && teachers.data.total > 100 ? <div className="flex items-center gap-3"><Button className="min-h-12" variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button className="min-h-12" variant="outline" disabled={page * 100 >= teachers.data.total} onClick={() => setPage(value => value + 1)}>Next</Button></div> : null}
    <Sheet open={!!selection} onOpenChange={open => { if (!open && !busy) setSelection(null); }}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>{selection ? labels[selection.action] : 'Review teacher'}</SheetTitle><SheetDescription>Class access changes independently of Events permissions. Every decision is recorded.</SheetDescription></SheetHeader>
      {selection ? <form className="space-y-5 p-4" onSubmit={async event => {
        event.preventDefault(); if (selection.action !== 'APPROVE' && !reason.trim()) { setError('Enter a reason.'); return; }
        setBusy(true); setError('');
        try { await fetchApi(`/api/admin/classroom/teachers/${selection.teacher.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: selection.commandId, expectedRevision: selection.teacher.revision, action: selection.action, ...(reason.trim() ? { reason: reason.trim() } : {}) }) }); setSelection(null); await teachers.refetch(); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Decision not confirmed. Retry with the same request.'); }
        finally { setBusy(false); }
      }}><p className="break-words font-semibold">{selection.teacher.user.name}</p><label className="block text-sm font-medium">Reason{selection.action === 'APPROVE' ? ' (optional)' : ''}<textarea disabled={busy} className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-3" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); setSelection(current => current ? { ...current, commandId: crypto.randomUUID() } : null); }} /></label>{error ? <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{error}</p><Button type="button" variant="outline" className="min-h-12" onClick={() => { setSelection(null); void teachers.refetch(); }}>Reload applications</Button></div> : null}<Button type="submit" className="min-h-12 w-full" disabled={busy}>{busy ? 'Saving…' : confirmations[selection.action]}</Button></form> : null}
    </SheetContent></Sheet>
  </div>;
}
