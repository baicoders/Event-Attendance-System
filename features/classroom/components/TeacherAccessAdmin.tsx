'use client';
import { RefreshCw, Search, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import { formatReportDateTime } from '@/globals/utils/reportTime';
import type { TeacherApplicationDto } from '../types/application';
import { useClassroomListState } from '../hooks/useClassroomListState';
import { Feedback, FilterToolbar, IdentityBlock, ListPagination, LoadingState, SectionPanel, StatusBadge } from './ui';
type Teacher = TeacherApplicationDto & { user: { id: string; name: string; email: string } };
const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'];
export default function TeacherAccessAdmin() {
  const { user } = useAuth();
  const { values, setValues, ready } = useClassroomListState({ status: 'PENDING', q: '', page: '1' });
  const [search, setSearch] = useState(values.q);
  useEffect(() => { setSearch(values.q); }, [values.q]);
  const status = !values.status || statuses.includes(values.status) ? values.status : 'PENDING';
  const page = Math.max(1, Math.min(100000, Number.parseInt(values.page, 10) || 1));
  const teachers = useQuery({ queryKey: ['classroom', 'admin', 'teachers', user?.id, user?.role, user?.credentialVersion, status, values.q, page], enabled: !!user && ready, queryFn: ({ signal }) => fetchApi<{ items: Teacher[]; total: number }>('/api/admin/classroom/teachers?' + new URLSearchParams({ ...(status ? { status } : {}), q: values.q, page: String(page), pageSize: '100' }), { signal }), staleTime: 0 });
  return <div className="space-y-5">
    <nav aria-label="Teacher access status" className="flex flex-wrap gap-1 border-b border-slate-200">{[...statuses, ''].map(value => <a key={value} href={'/class/admin/teachers?' + new URLSearchParams({ status: value, ...(values.q ? { q: values.q } : {}) })} aria-current={status === value ? 'page' : undefined} onClick={event => { event.preventDefault(); setValues({ status: value, page: '1' }); }} className={'inline-flex min-h-12 items-center border-b-2 px-4 text-sm font-medium ' + (status === value ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-900')}>{value ? value.charAt(0) + value.slice(1).toLowerCase() : 'All statuses'}</a>)}</nav>
    <SectionPanel title={status === 'PENDING' ? 'Applications to review' : 'Teacher accounts'} description="Open an application to review the teacher’s details and make an access decision." contentClassName="p-0" actions={<Button variant="ghost" disabled={teachers.isFetching} onClick={() => void teachers.refetch()}><RefreshCw aria-hidden className="size-4 shrink-0"/>Refresh</Button>}>
      <form onSubmit={event => { event.preventDefault(); setValues({ q: search.trim(), page: '1' }); }}><FilterToolbar resultCount={teachers.data?.total} onReset={values.q ? () => { setSearch(''); setValues({ q: '', page: '1' }); } : undefined}><div className="min-w-0 flex-1"><FormInput label="Search teachers" placeholder="Teacher name or email" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></div><Button type="submit" variant="outline"><Search aria-hidden className="size-4 shrink-0"/>Search</Button></FilterToolbar></form>
      {!ready || teachers.isLoading ? <LoadingState label="Loading teacher applications…" /> : teachers.isError ? <div className="p-5"><Feedback title="Unable to load teacher applications" onRetry={() => void teachers.refetch()}>Check your connection and administrator access.</Feedback></div> : !teachers.data?.items.length ? <div className="p-6"><Feedback title={status === 'PENDING' && !values.q ? 'No pending applications' : 'No matching teacher applications'} tone="info">{values.q ? 'Try another name or email, or choose another status.' : 'New applications will appear here when submitted.'}</Feedback></div> : <>
        <ul className="divide-y divide-slate-100">{teachers.data.items.map(teacher => <li key={teacher.userId} className="flex flex-wrap items-center gap-4 p-5 sm:px-6"><div className="min-w-0 flex-1 basis-60"><IdentityBlock name={teacher.user.name} identifier={teacher.user.email} description={<><span className="block">{teacher.departmentOrDesignation}</span><span className="mt-1 block text-xs">Applied {formatReportDateTime(teacher.appliedAt)}</span></>} /></div><StatusBadge tone={teacher.status === 'APPROVED' ? 'success' : teacher.status === 'PENDING' ? 'warning' : teacher.status === 'REVOKED' ? 'danger' : 'neutral'}>{teacher.status.charAt(0) + teacher.status.slice(1).toLowerCase()}</StatusBadge><Button variant={teacher.status === 'PENDING' ? 'default' : 'outline'} asChild><Link prefetch={false} href={'/class/admin/teachers/' + encodeURIComponent(teacher.userId)} aria-label={'Review application — ' + teacher.user.name}><ClipboardCheck aria-hidden className="size-4 shrink-0"/>Review application →</Link></Button></li>)}</ul>
        <div className="px-5 pb-4 sm:px-6"><ListPagination page={page} pageSize={100} total={teachers.data.total} onPageChange={next => setValues({ page: String(next) })} isPending={teachers.isFetching} /></div>
      </>}
    </SectionPanel>
    <p className="text-sm leading-6 text-slate-500">Reasons and access decisions remain in the administrative history. Classroom and Events permissions are managed independently.</p>
  </div>;
}
