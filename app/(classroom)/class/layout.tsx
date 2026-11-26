import { redirect } from 'next/navigation';
import { AuthError } from '@/globals/utils/auth';
import { requireClassroomActor } from '@/features/classroom/server/http';
import ClassroomShell from '@/features/classroom/components/ClassroomShell';
export default async function ClassLayout({ children }: { children: React.ReactNode }) {
  try { await requireClassroomActor(); }
  catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.code === 'UNAUTHORIZED') redirect('/login?workspace=CLASS');
    if (error.code === 'PASSWORD_CHANGE_REQUIRED' || error.code === 'ACCOUNT_DISABLED') redirect('/account/settings');
    redirect('/class/access');
  }
  return <ClassroomShell>{children}</ClassroomShell>;
}
