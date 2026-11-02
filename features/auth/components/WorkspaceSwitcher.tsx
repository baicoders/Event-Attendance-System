'use client';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/globals/components/shad-cn/button';
import { DropdownMenuItem } from '@/globals/components/shad-cn/dropdown-menu';
import { useAuth } from '@/globals/contexts/AuthContext';
import { workspaceCapabilities } from '../utils/accessPolicy';
import { resolveWorkspaceDestination } from '../utils/workspaceDestination';
import { useWorkspacePreference } from '../hooks/useWorkspacePreference';
export default function WorkspaceSwitcher({ menu = false }: { menu?: boolean }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { setWorkspace } = useWorkspacePreference();
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  if (!user || !grants?.events || !grants.classroom) return null;
  const target = pathname.startsWith('/class') ? 'EVENTS' : 'CLASS';
  const switchWorkspace = () => {
    if (!window.dispatchEvent(new CustomEvent('workspace:before-change', { cancelable: true }))) return;
    window.dispatchEvent(new Event('workspace:changed'));
    setWorkspace(target);
    router.push(resolveWorkspaceDestination(user, target));
    router.refresh();
  };
  const label = `Switch to ${target === 'CLASS' ? 'Class' : 'Events'}`;
  return menu ? <DropdownMenuItem className="min-h-12" onSelect={switchWorkspace}><ArrowLeftRight aria-hidden className="size-4" />{label}</DropdownMenuItem> : <Button className="min-h-12 w-full" variant="outline" onClick={switchWorkspace}><ArrowLeftRight aria-hidden className="size-4" />{label}</Button>;
}
