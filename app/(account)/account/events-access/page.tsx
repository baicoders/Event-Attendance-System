import { redirect } from 'next/navigation';
import { getFreshAuthSession } from '@/globals/utils/auth';
import EventsAccessStatus from '@/features/auth/components/EventsAccessStatus';
export default async function EventsAccessPage() {
  const user = await getFreshAuthSession();
  if (!user) redirect('/login?workspace=EVENTS');
  if (user.accountState === 'DISABLED' || user.mustChangePassword) redirect('/account/settings');
  return <EventsAccessStatus />;
}
