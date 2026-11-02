import Link from 'next/link';
import PageHeader from '@/globals/components/shared/PageHeader';
import { page, surface } from '@/globals/constants/designTokens';
export default function TeacherSettings() {
  return <div className={page.surface}><div className={page.container}><PageHeader eyebrow="Class" title="Profile / Settings" description="Manage your account and classroom preferences." /><div className={`${surface.panel} space-y-4 p-6`}>
    <Link href="/account/settings" className="flex min-h-12 items-center text-indigo-700 underline">Profile and password</Link>
    <Link href="/class/onboarding" className="flex min-h-12 items-center text-indigo-700 underline">Classroom setup guide</Link>
    <Link href="/account/events-access" className="flex min-h-12 items-center text-indigo-700 underline">Events workspace access</Link>
  </div></div></div>;
}
