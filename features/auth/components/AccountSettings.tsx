'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useAuth } from '@/globals/contexts/AuthContext';
import ChangePasswordForm from '@/features/settings/components/ChangePasswordForm';
import { Button } from '@/globals/components/shad-cn/button';
import AccountControls from './AccountControls';
import AccountDialog from './AccountDialog';
export default function AccountSettings({ intercepted = false }: { intercepted?: boolean }) {
 const { user, isLoading, isUnavailable, refresh } = useAuth(); const router = useRouter(); const [busy, setBusy] = useState(false);
 const restricted = !!user && (user.mustChangePassword || user.accountState === 'DISABLED');
 return <AccountDialog intercepted={intercepted} icon={KeyRound} title={user?.mustChangePassword ? 'Choose a new password' : 'Your account'} description={user?.mustChangePassword ? 'Replace the temporary password before continuing.' : 'Your account information and password for both workspaces.'} locked={!!restricted || isLoading} busy={busy} footer={user ? <AccountControls disabled={busy} /> : undefined}>
 {isUnavailable ? <div role="alert" className="space-y-3"><p>Unable to check access.</p><Button onClick={() => void refresh()}><RefreshCw aria-hidden className="size-4" />Retry connection</Button></div> : isLoading ? <p role="status">Checking access…</p> : !user ? <Button asChild variant="outline"><Link href="/login">Sign in to continue</Link></Button> : <><dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm"><div><dt className="text-slate-500">Name</dt><dd className="mt-1 break-words font-medium">{user.name}</dd></div><div><dt className="text-slate-500">Email</dt><dd className="mt-1 break-all font-medium">{user.email}</dd></div></dl>{user.accountState === 'DISABLED' ? <p role="alert">Account access is disabled. Contact a school administrator for help.</p> : <ChangePasswordForm onSubmittingChange={setBusy} submitLabel={user.mustChangePassword ? 'Set password and continue' : 'Change password'} onSuccess={() => { if (user.mustChangePassword) { router.replace('/'); router.refresh(); } }} />}</>}
 </AccountDialog>;
}
