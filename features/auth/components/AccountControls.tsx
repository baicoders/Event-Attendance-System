'use client';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/globals/components/shad-cn/button';
import { useAuth } from '@/globals/contexts/AuthContext';
import { toastDanger } from '@/globals/components/shared/toasts';
export default function AccountControls({ disabled = false }: { disabled?: boolean }) {
  const { logout } = useAuth();
  const router = useRouter();
  return <Button disabled={disabled} className="min-h-12" variant="outline" onClick={async () => { if (await logout()) { router.replace('/login'); router.refresh(); } else toastDanger('Could not sign out. Try again.'); }}><LogOut aria-hidden className="size-4" />Sign out</Button>;
}
