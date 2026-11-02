import { redirect } from 'next/navigation';
import { getFreshAuthSession } from '@/globals/utils/auth';
import { classroomAvailableFor } from '@/features/classroom/server/featureFlags';
import TeacherAccessStatus from '@/features/classroom/components/TeacherAccessStatus';
export default async function TeacherAccessPage() {
  const user = await getFreshAuthSession();
  if (!user) redirect('/login?workspace=CLASS');
  if (user.accountState === 'DISABLED' || user.mustChangePassword) redirect('/account/settings');
  if (user.role === 'ADMIN' && user.status === 'ACTIVE') redirect('/class/admin/teachers');
  return <TeacherAccessStatus moduleAvailable={classroomAvailableFor(user.id, user.role === 'ADMIN')} />;
}
