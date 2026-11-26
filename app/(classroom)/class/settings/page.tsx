import Link from 'next/link';
import { ChevronRight, BookOpen, KeyRound, LayoutGrid } from 'lucide-react';
import { ClassroomPage, SectionPanel } from '@/features/classroom/components/ui';
const rows = [
 { href: '/account/settings', title: 'Account and password', description: 'View your account information and change your password.', icon: KeyRound },
 { href: '/class/help', title: 'Teacher guide & help', description: 'Continue setup or find help with rosters, attendance and reports.', icon: BookOpen },
 { href: '/account/events-access', title: 'Events workspace access', description: 'Review your Events access and application.', icon: LayoutGrid },
];
export default function TeacherSettings() {
 return <ClassroomPage eyebrow="Classroom" title="Settings" description="Your account, classroom setup, and workspace access."><SectionPanel className="mx-auto w-full max-w-[760px]" contentClassName="p-0 sm:p-0"><nav aria-label="Settings" className="divide-y divide-slate-100">{rows.map(({ icon: Icon, ...row }) => <Link key={row.href} href={row.href} scroll={false} className="group flex min-h-12 items-center gap-4 p-5 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-600 sm:p-6"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Icon aria-hidden className="size-5" /></span><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900 group-hover:text-indigo-700">{row.title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{row.description}</p></div><ChevronRight aria-hidden className="size-5 shrink-0 text-slate-400" /></Link>)}</nav></SectionPanel></ClassroomPage>;
}
