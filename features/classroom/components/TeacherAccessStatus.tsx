'use client';
import { ArrowRight, RefreshCw, Save, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError, fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { Textarea } from '@/globals/components/shad-cn/textarea';
import FormInput from '@/globals/components/shared/FormInput';
import { ActionFooter, ClassroomPage, Feedback, FormSection, LoadingState, SectionPanel, StatusBadge } from './ui';
import AccountControls from '@/features/auth/components/AccountControls';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';
import { teacherApplicationSchema } from '../schemas/applicationSchema';
import type { TeacherApplicationDto } from '../types/application';

export default function TeacherAccessStatus({ moduleAvailable }: { moduleAvailable: boolean }) {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const application = useQuery({ queryKey: ['classroom', 'application', user?.id, user?.role, user?.classroomStatus, user?.credentialVersion], enabled: !!user && !user.mustChangePassword && !isUnavailable, staleTime: 0, refetchOnMount: 'always',
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
  if (isLoading || application.isLoading || application.isFetching) return <main><ClassroomPage eyebrow="Workspace access" title="Teacher access"><LoadingState label="Loading your teacher application…" /></ClassroomPage></main>;
  if (isUnavailable || application.isError) return <main><ClassroomPage eyebrow="Workspace access" title="Teacher access"><Feedback title="Unable to load your application" onRetry={() => { void refresh(); void application.refetch(); }}>Check your connection and retry.</Feedback></ClassroomPage></main>;
  const canEdit = !member || member.status === 'PENDING' || member.status === 'REJECTED';
  const title = !member ? 'Apply for teacher access' : ({ PENDING: 'Teacher access pending', APPROVED: 'Teacher access approved', REJECTED: 'Update your teacher application', SUSPENDED: 'Class access suspended', REVOKED: 'Class access revoked' }[member.status]);
  const description = member?.status === 'PENDING' ? 'Your application is waiting for a school administrator to review it. You can keep your details up to date while you wait.' : member?.status === 'APPROVED' ? (moduleAvailable ? 'Your teacher account is ready. Open Classroom to manage your classes and attendance.' : 'Your approval is saved. Classroom will be available when the school opens this workspace.') : member?.status === 'REJECTED' ? 'Review the administrator’s feedback, update your details, and resubmit your application.' : member?.status === 'SUSPENDED' ? 'An administrator has paused your Classroom access. Review the recorded reason and contact your school administrator about next steps.' : member?.status === 'REVOKED' ? 'Your Classroom access has been removed. Contact your school administrator to discuss restoring access.' : 'Apply once to create classes, save your roster, and scan students’ existing QR codes after approval.';
  return <main><ClassroomPage eyebrow="Workspace access" title={title} description="Manage your teacher application and Classroom access." className="max-w-5xl">
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"><div className="min-w-0 space-y-6"><SectionPanel title="Your access status" actions={<StatusBadge tone={member?.status === 'APPROVED' ? 'success' : member?.status === 'PENDING' ? 'warning' : member?.status === 'SUSPENDED' || member?.status === 'REVOKED' ? 'danger' : 'neutral'}>{member ? member.status.charAt(0) + member.status.slice(1).toLowerCase() : 'Not applied'}</StatusBadge>}>
      <p className="text-sm leading-6 text-slate-600">{description}</p>
      {member?.decisionReason ? <Feedback title="Administrator’s reason" tone={member.status === 'APPROVED' ? 'info' : 'warning'}><p className="whitespace-pre-wrap break-words">{member.decisionReason}</p></Feedback> : null}
      {member?.status === 'APPROVED' && grants?.classroom && moduleAvailable ? <Button asChild><Link href="/class"><ArrowRight aria-hidden className="size-4 shrink-0"/>Continue to Classroom →</Link></Button> : null}
      <Button variant="outline" onClick={() => { void application.refetch(); void refresh(); }}><RefreshCw aria-hidden className="size-4 shrink-0"/>Check status</Button>
    </SectionPanel>
    {canEdit ? <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (!busy) void save(member?.status === 'PENDING' ? 'SAVE' : 'SUBMIT'); }}>
      <FormSection title="Application details" description="Give your school administrator the information needed to review your application.">
        <FormInput className="min-h-12" label="Department or teaching designation" value={designation} maxLength={160} disabled={busy} onChange={event => { setDesignation(event.target.value); pending.current = null; }} />
        <FormInput className="min-h-12" label="Staff reference (optional)" value={reference} maxLength={100} disabled={busy} onChange={event => { setReference(event.target.value); pending.current = null; }} />
        <label className="block text-sm font-medium text-slate-700">Application information (optional)<Textarea className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-3" value={message} maxLength={1000} disabled={busy} onChange={event => { setMessage(event.target.value); pending.current = null; }} /></label>
      </FormSection>
      {error ? <Feedback title="Application save not confirmed"><p>{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void loadCurrent()}><RefreshCw aria-hidden className="size-4 shrink-0"/>Reload current application</Button></Feedback> : null}
      <ActionFooter description={member?.status === 'PENDING' ? 'Your application stays pending while your details are updated.' : 'A school administrator will review your application.'}><Button type="submit" disabled={busy}><Save aria-hidden className="size-4 shrink-0"/>{busy ? 'Saving…' : member?.status === 'PENDING' ? 'Save application details' : member ? 'Resubmit application' : 'Submit application'}</Button></ActionFooter>
    </form> : error ? <Feedback title="Application unavailable">{error}</Feedback> : null}</div>
    <SectionPanel title="Account and workspaces" description="Your account stays available while your application is reviewed."><nav aria-label="Account and workspace links" className="space-y-1"><Link className="gap-2 flex min-h-12 items-center text-sm font-semibold text-indigo-700 hover:underline" href="/account/settings"><KeyRound aria-hidden className="size-4 shrink-0"/>Profile and password →</Link>{grants?.events ? <Link className="flex min-h-12 items-center text-sm font-semibold text-indigo-700 hover:underline" href="/dashboard">Open Events →</Link> : null}</nav><div className="border-t border-slate-100 pt-4"><AccountControls /></div></SectionPanel></div>
  </ClassroomPage></main>;
}
