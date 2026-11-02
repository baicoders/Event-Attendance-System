import { redirect } from 'next/navigation';
import { AuthError, requireAdmin } from '@/globals/utils/auth';
import ClassroomShell from '@/features/classroom/components/ClassroomShell';
export default async function ClassroomAdminLayout({ children }: { children: React.ReactNode }) {
  try { await requireAdmin(); }
  catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.code === 'UNAUTHORIZED') redirect('/login?workspace=CLASS');
    if (error.code === 'PASSWORD_CHANGE_REQUIRED' || error.code === 'ACCOUNT_DISABLED') redirect('/account/settings');
    redirect('/class/access');
  }
  return <ClassroomShell admin>{children}</ClassroomShell>;
}
