import { redirect } from 'next/navigation';
import { getFreshAuthSession } from '@/globals/utils/auth';
import AccountSettings from '@/features/auth/components/AccountSettings';
export default async function AccountSettingsPage() {
  if (!await getFreshAuthSession()) redirect('/login');
  return <AccountSettings intercepted />;
}
