import { workspaceCapabilities, type ClassroomAccessStatus, type WorkspaceIdentity } from './accessPolicy';
export type Workspace = 'EVENTS' | 'CLASS';
type WorkspaceUser = WorkspaceIdentity & { classroomStatus?: ClassroomAccessStatus | null };
export function readWorkspacePreference(search: string, remembered?: string | null, fallback: Workspace = 'EVENTS'): Workspace {
  const selected = new URLSearchParams(search).get('workspace')?.toUpperCase();
  if (selected === 'CLASS' || selected === 'EVENTS') return selected;
  return remembered === 'CLASS' || remembered === 'EVENTS' ? remembered : fallback;
}
export function resolveWorkspaceDestination(user: WorkspaceUser | null, workspace: Workspace, returnTo?: string | null): string {
  if (!user) return `/login?workspace=${workspace}`;
  if (user.accountState === 'DISABLED' || user.mustChangePassword) return '/account/settings';
  const grants = workspaceCapabilities(user, user.classroomStatus);
  const permitted = workspace === 'CLASS' ? grants.classroom : grants.events;
  const fallback = workspace === 'CLASS' ? (permitted ? (grants.admin ? '/class/admin/teachers' : '/class') : '/class/access') : (permitted ? '/dashboard' : '/account/events-access');
  if (!permitted || !returnTo || returnTo.length > 2048 || !returnTo.startsWith('/') || returnTo.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(returnTo)) return fallback;
  const target = new URL(returnTo, 'https://internal.invalid');
  if (target.origin !== 'https://internal.invalid') return fallback;
  const path = target.pathname;
  const allowed = workspace === 'CLASS'
    ? (path === '/class' || path.startsWith('/class/')) && (grants.admin || !path.startsWith('/class/admin'))
    : ['/dashboard', '/calendar', '/attendance', '/students', '/reports', '/settings', '/custom-groups'].some(root => path === root || path.startsWith(`${root}/`));
  return allowed ? `${path}${target.search}${target.hash}` : fallback;
}
