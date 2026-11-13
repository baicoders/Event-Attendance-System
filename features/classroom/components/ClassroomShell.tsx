'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider } from '@/globals/contexts/SidebarContext';
import { useAuth } from '@/globals/contexts/AuthContext';
import MobileTopBar from '@/globals/components/shared/MobileTopBar';
import { Button } from '@/globals/components/shad-cn/button';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';
import { ClassroomSidebar, ClassroomBottomNav } from './ClassroomNavigation';
export default function ClassroomShell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, isLoading, isUnavailable, refresh } = useAuth();
  const router = useRouter();
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  const allowed = admin ? grants?.admin : grants?.classroom;
  useEffect(() => {
    if (isLoading || isUnavailable) return;
    if (!user) router.replace('/login?workspace=CLASS');
    else if (user.accountState === 'DISABLED' || user.mustChangePassword) router.replace('/account/settings');
    else if (!allowed) router.replace('/class/access');
  }, [isLoading, isUnavailable, user, allowed, router]);
  if (isUnavailable) return <main className="space-y-4 p-6" role="alert"><p>Connection unavailable. Attendance saves must be confirmed by the server.</p><Button className="min-h-12" onClick={() => void refresh()}>Retry connection</Button></main>;
  if (isLoading || !user || !allowed) return <main className="p-6 text-slate-600">Checking Class access…</main>;
  return <SidebarProvider key={user.id}><div className="flex min-h-screen bg-slate-100"><ClassroomSidebar admin={admin} /><div className="flex min-w-0 flex-1 flex-col"><MobileTopBar workspace="CLASS" /><main className="mx-auto w-full min-w-0 max-w-7xl flex-1 pb-24 lg:pb-0">{children}</main><ClassroomBottomNav admin={admin} /></div></div></SidebarProvider>;
}
