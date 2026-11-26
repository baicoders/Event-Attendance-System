'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, ChevronRight, CircleCheck, ClipboardList, RotateCcw, ScanLine } from 'lucide-react';
import { buttonVariants } from '@/globals/components/shad-cn/button';
import { Skeleton } from '@/globals/components/shad-cn/skeleton';
import { useTeacherOnboarding } from '../../hooks/useTeacherOnboarding';
import { ClassroomPage, Feedback, SectionPanel } from '../ui';
import TeacherLesson from './TeacherLesson';
import { lessons, type HelpTopic } from './lessons';

const topics = Object.keys(lessons) as HelpTopic[];

const setupLinks = [
  { label: 'Replay introduction', href: '/class/onboarding?replay=introduction', icon: RotateCcw },
  { label: 'Try practice attendance', href: '/class/onboarding?replay=practice', icon: ScanLine },
  { label: 'Open my classes', href: '/class/classes', icon: BookOpen },
];

export default function TeacherHelp() {
  const { query } = useTeacherOnboarding();
  const completed = Boolean(query.data?.completedAt);
  const className = query.data?.class?.displayName;
  const SetupIcon = completed ? CircleCheck : ClipboardList;

  return (
    <ClassroomPage
      className="max-w-3xl"
      eyebrow="Classroom"
      title="Teacher guide & help"
      description="Short lessons you can return to whenever you need them."
    >
      <SectionPanel
        footer={
          <div className="flex w-full flex-wrap gap-x-2 gap-y-1">
            {setupLinks.map(({ label, href, icon: Icon }) => (
              <Link key={href} href={href} className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-800' })}>
                <Icon aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        }
      >
        {query.isPending ? (
          <div role="status" className="flex min-h-12 items-center gap-3">
            <span className="sr-only">Loading saved setup…</span>
            <Skeleton className="size-10 shrink-0 rounded-xl motion-reduce:animate-none" />
            <Skeleton className="h-5 w-44 max-w-full motion-reduce:animate-none" />
          </div>
        ) : query.isError ? (
          <Feedback title="Unable to load setup progress" onRetry={() => void query.refetch()} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                <SetupIcon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="break-words text-base leading-6 font-semibold text-slate-900">
                  {completed ? 'Your setup is complete' : 'Your classroom setup'}
                </h2>
                {className && <p className="mt-1 break-words text-sm text-slate-600">{className}</p>}
              </div>
            </div>
            <Link href="/class/onboarding" className={buttonVariants({ className: 'w-full sm:w-auto' })}>
              {completed ? 'View completion summary' : 'Continue setup'}
              <ArrowRight aria-hidden />
            </Link>
          </div>
        )}
      </SectionPanel>

      <nav id="guide-topics" aria-label="Guide topics" tabIndex={-1} className="scroll-mt-6 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        <SectionPanel title="Guide topics" icon={BookOpen} contentClassName="p-0 sm:p-0">
          <ul className="grid gap-px bg-slate-100 sm:grid-cols-2">
            {topics.map(topic => (
              <li key={topic} className="min-w-0 bg-white">
                <a
                  href={'#' + topic}
                  className="group flex h-full min-h-12 items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-slate-900 transition-colors hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 sm:px-6"
                >
                  <span className="min-w-0 break-words">{lessons[topic].title}</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 group-hover:text-indigo-700" />
                </a>
              </li>
            ))}
          </ul>
        </SectionPanel>
      </nav>

      {topics.map(topic => (
        <section key={topic} id={topic} tabIndex={-1} className="scroll-mt-6 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          <SectionPanel title={lessons[topic].title}>
            <TeacherLesson topic={topic} />
            <a className="flex min-h-12 items-center text-sm text-indigo-700 underline" href="#guide-topics">Back to topics</a>
          </SectionPanel>
        </section>
      ))}
    </ClassroomPage>
  );
}
