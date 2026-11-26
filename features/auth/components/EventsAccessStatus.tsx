'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError, fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { workspaceCapabilities } from '../utils/accessPolicy';
import AccountControls from './AccountControls';
import AccountDialog from './AccountDialog';
export default function EventsAccessStatus({ intercepted = false }: { intercepted?: boolean }) {
 const { user, isLoading, isUnavailable, refresh } = useAuth(); const router = useRouter();
 const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const key = useRef<string | null>(null);
 const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
 useEffect(() => { if (grants?.events && !isUnavailable) router.replace('/dashboard'); else if (user?.accountState === 'DISABLED' || user?.mustChangePassword) router.replace('/account/settings'); }, [grants?.events, isUnavailable, router, user?.accountState, user?.mustChangePassword]);
 return <AccountDialog intercepted={intercepted} icon={LayoutGrid} title={user?.role === 'MEMBER' ? 'Request Events access' : user?.status === 'PENDING' ? 'Events access pending' : 'Events access unavailable'} description="An administrator reviews Events access separately from your Classroom access." busy={busy} locked={isLoading || user?.accountState === 'DISABLED' || !!user?.mustChangePassword} footer={user ? <AccountControls disabled={busy} /> : undefined}>
 {isLoading ? <p role="status">Checking Events access…</p> : !user ? <Button asChild variant="outline"><Link href="/login?workspace=EVENTS">Sign in</Link></Button> : <><div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="break-words font-semibold">{user.name}</p><p className="mt-1 break-all text-slate-500">{user.email}</p></div><p className="text-sm leading-6 text-slate-600">{user.role === 'MEMBER' ? 'You can request organizer access for the Events workspace using this same account. Your Classroom access is unchanged.' : user.rejectionReason || 'Your existing Classroom access is unchanged.'}</p>
 {error || isUnavailable ? <p role="alert" className="text-sm text-rose-700">{error || 'Connection unavailable. Retry the status check.'}</p> : null}
 <div className="flex flex-wrap gap-3">{user.role === 'MEMBER' ? <Button disabled={busy || isUnavailable} onClick={async () => { key.current ??= crypto.randomUUID(); setBusy(true); setError(''); try { await fetchApi('/api/auth/events-application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: key.current }) }); await refresh(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Request not confirmed. Retry to check the same request.'); } finally { setBusy(false); } }}><Send aria-hidden className="size-4" />{busy ? 'Submitting…' : 'Request organizer access'}</Button> : null}<Button disabled={busy} variant="outline" onClick={() => void refresh()}><RefreshCw aria-hidden className="size-4" />Check status</Button></div>
 {!grants?.classroom && !busy ? <Link href="/class/access" className="inline-flex min-h-12 items-center text-sm font-semibold text-indigo-700 underline">Apply for Teacher Access</Link> : null}</>}
 </AccountDialog>;
}
