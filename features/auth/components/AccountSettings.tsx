'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/globals/contexts/AuthContext';
import ChangePasswordForm from '@/features/settings/components/ChangePasswordForm';
import { Button } from '@/globals/components/shad-cn/button';
import AccountControls from './AccountControls';
export default function AccountSettings() {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const router = useRouter();
  if (isUnavailable) return <main className="p-6" role="alert">Unable to check access. <Button className="min-h-12" onClick={() => void refresh()}>Retry connection</Button></main>;
  if (isLoading) return <main className="p-6">Checking access…</main>;
  if (!user) return <main className="p-6"><Button asChild variant="outline"><Link href="/login">Sign in to continue</Link></Button></main>;
  return <main className="mx-auto min-h-screen w-full max-w-xl space-y-6 p-6 text-slate-900">
    <h1 className="text-2xl font-semibold">{user.mustChangePassword ? 'Choose a new password' : 'Your account'}</h1>
    <p className="break-words">{user.name} · {user.email}</p>
    {user.accountState === 'DISABLED' ? <p role="alert">Account access is disabled. Contact a school administrator for help.</p> : <><p className="text-sm text-slate-600">{user.mustChangePassword ? 'Replace the temporary password before continuing.' : 'Manage the password for both workspaces.'}</p><ChangePasswordForm submitLabel={user.mustChangePassword ? 'Set password and continue' : 'Change password'} onSuccess={() => { if (user.mustChangePassword) { router.replace('/'); router.refresh(); } }} /></>}
    <AccountControls />
    {!user.mustChangePassword && user.accountState !== 'DISABLED' ? <Link className="text-sm font-semibold inline-flex min-h-12 items-center text-indigo-700 underline" href="/">Return to attendance</Link> : null}
  </main>;
}
