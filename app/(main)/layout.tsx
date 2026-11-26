import { redirect } from 'next/navigation';
import { getFreshAuthSession } from '@/globals/utils/auth';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';
import EventsShell from '@/globals/components/shared/EventsShell';
export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  const user = await getFreshAuthSession();
  if (!user) redirect('/login?workspace=EVENTS');
  if (user.accountState === 'DISABLED' || user.mustChangePassword) redirect('/account/settings');
  if (!workspaceCapabilities(user, user.classroomStatus).events) redirect(workspaceCapabilities(user, user.classroomStatus).classroom ? '/class' : user.role === 'MEMBER' ? '/class/access' : '/account/events-access');
  return <EventsShell>{children}</EventsShell>;
}
