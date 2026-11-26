import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getFreshAuthSession } from '@/globals/utils/auth';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';
import { resolveWorkspaceDestination } from '@/features/auth/utils/workspaceDestination';
export default async function Root() {
  const user = await getFreshAuthSession();
  const preference = (await cookies()).get('attendance-workspace')?.value;
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  const workspace = preference === 'CLASS' || (grants?.classroom && !grants.events) ? 'CLASS' : 'EVENTS';
  redirect(resolveWorkspaceDestination(user, workspace));
}
