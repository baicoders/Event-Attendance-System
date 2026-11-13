import Link from 'next/link';
import { Button } from '@/globals/components/shad-cn/button';
import type { AuthUser } from '@/globals/contexts/AuthContext';
import type { ClassSummary } from '../types/class';
import { formatManila } from '../utils/manualRosterState';

export default function ClassCard({ item, viewerRole, basePath = '/class/classes', showTeacher = false }: {
  item: ClassSummary;
  viewerRole: AuthUser['role'] | undefined;
  basePath?: string;
  showTeacher?: boolean;
}) {
  const href = basePath + '/' + encodeURIComponent(item.id);
  const administrator = viewerRole === 'ADMIN';
  const canStart = !!viewerRole && !administrator && !item.archivedAt;
  return <article className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="min-w-0 flex-1 space-y-3">
      <h2 className="break-words text-xl font-semibold text-slate-900">{item.displayName}</h2>
      <p className="break-words text-sm text-slate-600">{item.subject.code ? item.subject.code + ' · ' : ''}{item.subject.title} · {item.term.name}</p>
      {showTeacher ? <p className="break-words text-sm text-slate-600">Teacher: {item.primaryTeacher.name}</p> : null}
      <p className="break-words text-sm text-slate-700">{item.sections.map(section => section.name).join(' + ') || 'Individual student roster'}</p>
      {item.schedule ? <p className="break-words text-sm text-slate-600">{item.schedule.startTime}{item.schedule.room ? ' · ' + item.schedule.room : ''} · Asia/Manila</p> : null}
      {item.archivedAt ? <p className="text-sm font-medium text-amber-800">Archived</p> : null}
      {item.latestSession ? <p className="text-sm text-slate-600">Latest meeting: {formatManila(item.latestSession.scheduledStartAt)} · {item.latestSession.state.toLowerCase()}</p> : null}
    </div>
    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
      {item.activeSession || canStart ? <Button asChild><Link href={item.activeSession ? '/class/sessions/' + encodeURIComponent(item.activeSession.id) : '/class/classes/' + encodeURIComponent(item.id) + '/start'}>{item.activeSession ? administrator ? 'View session' : 'Continue session' : 'Start attendance'}</Link></Button> : null}
      <Button asChild variant="outline"><Link href={href}>Open class</Link></Button>
      <Button asChild variant="outline"><Link href={href + '/roster'}>Manage roster</Link></Button>
      <Button asChild variant="outline"><Link href={'/class/reports?' + new URLSearchParams({ termId: item.termId, classId: item.id })}>Reports</Link></Button>
    </div>
  </article>;
}
