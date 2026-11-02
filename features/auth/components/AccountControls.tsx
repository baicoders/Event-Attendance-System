'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/globals/components/shad-cn/button';
import { useAuth } from '@/globals/contexts/AuthContext';
import { toastDanger } from '@/globals/components/shared/toasts';
export default function AccountControls() {
  const { logout } = useAuth();
  const router = useRouter();
  return <Button className="min-h-12" variant="outline" onClick={async () => { if (await logout()) { router.replace('/login'); router.refresh(); } else toastDanger('Could not sign out. Try again.'); }}>Sign out</Button>;
}
