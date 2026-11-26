'use client';
import { UserRound, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import type { DirectoryResponse, DirectoryStudent } from '../types/student';
import { useClassroomListState } from '../hooks/useClassroomListState';
import { Feedback, FilterToolbar, IdentityBlock, LoadingState, ResponsiveDataList, SectionPanel, StatusBadge } from './ui';
const fullName = (student: DirectoryStudent) => `${student.lastName}, ${student.firstName}${student.middleName ? ' ' + student.middleName : ''}`;
const identifiers = (student: DirectoryStudent) => [student.usn ? `USN: ${student.usn}` : '', student.lrn ? `LRN: ${student.lrn}` : ''].filter(Boolean).join(' · ') || 'No printed identifier';
const section = (student: DirectoryStudent) => student.groups.filter(group => group.category === 'SECTION').map(group => group.name).join(', ') || 'No official section';
function Verification({ state }: { state: string }) {
  return <StatusBadge tone={state === 'VERIFIED' ? 'success' : state === 'NEEDS_CORRECTION' ? 'warning' : 'neutral'}>{state === 'VERIFIED' ? 'Verified' : state === 'NEEDS_CORRECTION' ? 'Needs correction' : 'Unverified'}</StatusBadge>;
}
const columns = (onOpen: () => void): ColumnDef<DirectoryStudent, unknown>[] => [
  { id: 'student', header: 'Student', cell: ({ row }) => <IdentityBlock name={fullName(row.original)} identifier={identifiers(row.original)} /> },
  { id: 'section', header: 'Official section', cell: ({ row }) => <span className="text-sm text-slate-600">{section(row.original)}</span> },
  { id: 'verification', header: 'Verification', cell: ({ row }) => <Verification state={row.original.verification.state} /> },
  { id: 'review', header: 'Profile', cell: ({ row }) => <Link onClick={onOpen} prefetch={false} className="gap-2 inline-flex min-h-12 items-center text-sm font-semibold text-indigo-700 hover:underline" href={'/class/students/' + encodeURIComponent(row.original.id)} aria-label={'View student — ' + fullName(row.original)}><UserRound aria-hidden className="size-4 shrink-0"/>View student →</Link> },
];
export default function StudentDirectory() {
  const { user } = useAuth();
  const { values, setValues, ready } = useClassroomListState({ q: '', page: '1' });
  const [search, setSearch] = useState(values.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openStudent = () => { if (searchTimer.current) clearTimeout(searchTimer.current); if (search.trim() !== values.q) setValues({ q: search.trim(), page: '1' }); };
  useEffect(() => { setSearch(values.q); }, [values.q]);
  useEffect(() => {
    if (!ready || search.trim() === values.q) return;
    searchTimer.current = setTimeout(() => setValues({ q: search.trim(), page: '1' }), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, values.q, ready, setValues]);
  const page = Math.max(1, Math.min(100000, Number.parseInt(values.page, 10) || 1));
  const directory = useQuery({ queryKey: ['classroom', 'students', user?.id, user?.role, user?.classroomStatus, user?.credentialVersion, values.q, page], enabled: !!user && ready, queryFn: ({ signal }) => fetchApi<DirectoryResponse>('/api/classroom/students?' + new URLSearchParams({ q: values.q, page: String(page), pageSize: '100' }), { signal }), staleTime: 0 });
  return <div className="space-y-5">
    <SectionPanel contentClassName="p-0" description="Review official details and verify student information. Class attendance stays private to its teacher.">
      <form onSubmit={event => { event.preventDefault(); setValues({ q: search.trim(), page: '1' }); }}>
        <FilterToolbar resultCount={directory.data?.total} onReset={values.q ? () => { setSearch(''); setValues({ q: '', page: '1' }); } : undefined}>
          <div className="min-w-0 flex-1"><FormInput label="Search students" placeholder="Name, USN or LRN" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></div>
          <Button type="submit" variant="outline"><Search aria-hidden className="size-4 shrink-0"/>Search</Button>
        </FilterToolbar>
      </form>
      {!ready || directory.isLoading ? <LoadingState label="Loading students…" /> : directory.isError ? <div className="p-5"><Feedback title="Unable to load students" onRetry={() => void directory.refetch()}>Check your connection and try again.</Feedback></div> : !directory.data?.items.length ? <div className="p-6"><Feedback title="No matching students" tone="info">Check the name or identifier. Student imports are managed by an administrator.</Feedback></div> : <ResponsiveDataList items={directory.data.items} columns={columns(openStudent)} getRowId={student => student.id} page={page} pageSize={100} total={directory.data.total} onPageChange={next => setValues({ page: String(next) })} isPending={directory.isFetching} renderMobile={student => <Link onClick={openStudent} prefetch={false} className="flex min-h-12 items-center justify-between gap-3 p-4 focus-visible:ring-2 focus-visible:ring-indigo-500" href={'/class/students/' + encodeURIComponent(student.id)}><div className="min-w-0 space-y-2"><IdentityBlock name={fullName(student)} identifier={identifiers(student)} description={section(student)} /><Verification state={student.verification.state} /></div><span aria-hidden className="text-indigo-600">→</span></Link>} />}
    </SectionPanel>
    <p className="text-sm leading-6 text-slate-500">Open a student to review their profile, verify information, or make a correction with a recorded reason.</p>
  </div>;
}
