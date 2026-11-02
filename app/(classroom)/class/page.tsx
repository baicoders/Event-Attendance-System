import Link from 'next/link';
import PageHeader from '@/globals/components/shared/PageHeader';
import { page, surface } from '@/globals/constants/designTokens';
export default function ClassroomDashboard() {
  return <div className={page.surface}><div className={page.container}>
    <PageHeader eyebrow="Class" title="My Classes" description="Your classes and attendance, in one place." />
    <section className={`${surface.panel} space-y-4 p-6`}><h2 className="text-lg font-semibold">Welcome to classroom attendance</h2><p className="text-sm text-slate-600">Choose your sections once, review the roster, then start each meeting and scan your students’ existing QR codes.</p><Link className="inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-4 font-semibold text-white" href="/class/classes/new">Create your first class</Link></section>
  </div></div>;
}
