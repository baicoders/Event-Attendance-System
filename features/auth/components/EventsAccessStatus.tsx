'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError, fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { workspaceCapabilities } from '../utils/accessPolicy';
import AccountControls from './AccountControls';
export default function EventsAccessStatus() {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null);
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  useEffect(() => { if (grants?.events && !isUnavailable) router.replace('/dashboard'); }, [grants?.events, isUnavailable, router]);
  if (isLoading) return <main className="p-6">Checking Events access…</main>;
  if (!user) return <main className="p-6"><Button asChild variant="outline"><Link href="/login?workspace=EVENTS">Sign in</Link></Button></main>;
  return <main className="mx-auto min-h-screen max-w-xl space-y-6 p-6 text-slate-900">
    <h1 className="text-2xl font-semibold">{user.role === 'MEMBER' ? 'Request Events access' : user.status === 'PENDING' ? 'Events access pending' : 'Events access unavailable'}</h1>
    <p className="text-sm text-slate-600">{user.role === 'MEMBER' ? 'You can request organizer access for the Events workspace using this same account. Your Classroom access is unchanged.' : user.rejectionReason || 'An administrator reviews organizer access separately. Your existing Classroom access is unchanged.'}</p>
    {error || isUnavailable ? <p role="alert" className="text-sm text-rose-700">{error || 'Connection unavailable. Retry the status check.'}</p> : null}
    {user.role === 'MEMBER' ? <Button className="min-h-12" disabled={busy || isUnavailable} onClick={async () => {
      key.current ??= crypto.randomUUID(); setBusy(true); setError('');
      try { await fetchApi('/api/auth/events-application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: key.current }) }); await refresh(); }
      catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Request not confirmed. Retry to check the same request.'); }
      finally { setBusy(false); }
    }}>{busy ? 'Submitting…' : 'Request organizer access'}</Button> : null}
    <Button className="min-h-12" variant="outline" onClick={() => void refresh()}>Check status</Button>
    {grants?.classroom ? <Link href="/class" className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline">Return to Class</Link> : <Link href="/class/access" className="text-sm font-semibold flex min-h-12 items-center text-indigo-700 underline">Apply for Teacher Access</Link>}
    <AccountControls />
  </main>;
}
