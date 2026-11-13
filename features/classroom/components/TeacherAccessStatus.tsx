'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError, fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import PageHeader from '@/globals/components/shared/PageHeader';
import AccountControls from '@/features/auth/components/AccountControls';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';
import { teacherApplicationSchema } from '../schemas/applicationSchema';
import type { TeacherApplicationDto } from '../types/application';

export default function TeacherAccessStatus({ moduleAvailable }: { moduleAvailable: boolean }) {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const application = useQuery({ queryKey: ['classroom', 'application', user?.id], enabled: !!user && !user.mustChangePassword && !isUnavailable, staleTime: 0, refetchOnMount: 'always',
    queryFn: () => fetchApi<TeacherApplicationDto | null>('/api/classroom/application') });
  const [designation, setDesignation] = useState('');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef<number | undefined>(undefined);
  const loaded = useRef(false);
  const pending = useRef<unknown>(null);
  const member = application.data;
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  const loadCurrent = async () => {
    const result = await application.refetch();
    if (result.isError) { setError('Unable to reload the current application.'); return; }
    const fresh = result.data;
    setDesignation(fresh?.departmentOrDesignation ?? ''); setReference(fresh?.staffReference ?? ''); setMessage(fresh?.applicationText ?? ''); revision.current = fresh?.revision; pending.current = null; setError('');
  };
  useEffect(() => {
    if (member && !loaded.current) { loaded.current = true; setDesignation(member.departmentOrDesignation); setReference(member.staffReference ?? ''); setMessage(member.applicationText); revision.current = member.revision; }
  }, [member]);
  const save = async (action: 'SAVE' | 'SUBMIT') => {
    const parsed = teacherApplicationSchema.safeParse({ commandId: crypto.randomUUID(), expectedRevision: revision.current, action, departmentOrDesignation: designation, staffReference: reference, applicationText: message });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the application.'); return; }
    if (!pending.current) pending.current = parsed.data;
    setBusy(true); setError('');
    try {
      await fetchApi('/api/classroom/application', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) });
      pending.current = null; loaded.current = false;
      await application.refetch(); await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Save not confirmed. Retry to check the same request.');
      if (cause instanceof ApiError && cause.status < 500) pending.current = null;
    } finally { setBusy(false); }
  };
  if (isLoading || application.isLoading || application.isFetching) return <main className="p-6">Loading your teacher application…</main>;
  if (isUnavailable || application.isError) return <main className="space-y-4 p-6" role="alert"><p>Unable to load your application. Check your connection and retry.</p><Button className="min-h-12" onClick={() => { void refresh(); void application.refetch(); }}>Retry connection</Button></main>;
  const canEdit = !member || member.status === 'PENDING' || member.status === 'REJECTED';
  const title = !member ? 'Apply for Teacher Access' : ({ PENDING: 'Teacher access pending', APPROVED: 'Teacher access approved', REJECTED: 'Teacher access rejected', SUSPENDED: 'Class access suspended', REVOKED: 'Class access revoked' }[member.status]);
  return <main className="mx-auto min-h-screen w-full max-w-xl space-y-6 p-6 text-slate-900">
    <PageHeader eyebrow="Class" title={title} />
    <p className="text-sm text-slate-600">{member?.status === 'PENDING' ? 'Your application is waiting for a school administrator to review it. After one approval, you can manage your own classes.' : member?.status === 'APPROVED' ? (moduleAvailable ? 'Your teacher account is ready.' : 'Your approval is saved. Classroom will be available when the school opens this workspace.') : member?.decisionReason || 'Apply once. After approval, create classes, save your roster and scan students’ existing QR codes.'}</p>
    {canEdit ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(member?.status === 'PENDING' ? 'SAVE' : 'SUBMIT'); }}>
      <FormInput className="min-h-12" label="Department or teaching designation" value={designation} maxLength={160} disabled={busy} onChange={event => { setDesignation(event.target.value); pending.current = null; }} />
      <FormInput className="min-h-12" label="Staff reference (optional)" value={reference} maxLength={100} disabled={busy} onChange={event => { setReference(event.target.value); pending.current = null; }} />
      <label className="block text-sm font-medium">Application information (optional)<textarea className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3" value={message} maxLength={1000} disabled={busy} onChange={event => { setMessage(event.target.value); pending.current = null; }} /></label>
      {error ? <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{error}</p><Button type="button" variant="outline" className="min-h-12" onClick={() => void loadCurrent()}>Reload current application</Button></div> : null}
      <Button type="submit" className="min-h-12 w-full" disabled={busy}>{busy ? 'Saving…' : member?.status === 'PENDING' ? 'Save application details' : member ? 'Resubmit application' : 'Submit application'}</Button>
    </form> : error ? <p role="alert">{error}</p> : null}
    {member?.status === 'APPROVED' && grants?.classroom && moduleAvailable ? <Link href="/class" className="flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Continue to Class</Link> : null}
    <Button className="min-h-12" variant="outline" onClick={() => { void application.refetch(); void refresh(); }}>Check status</Button>
    {grants?.events ? <Link className="flex min-h-12 items-center text-sm font-semibold text-indigo-700 underline" href="/dashboard">Open Events</Link> : null}
    <Link className="flex min-h-12 items-center text-sm font-semibold text-indigo-700 underline" href="/account/settings">Profile and password</Link><AccountControls />
  </main>;
}
