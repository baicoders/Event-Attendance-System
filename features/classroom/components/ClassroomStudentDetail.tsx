'use client';
import Link from 'next/link';
import { FilePenLine, ClipboardList, UserRound, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import type { DirectoryStudent } from '../types/student';
import StudentCorrectionSheet from './StudentCorrectionSheet';
import VerificationPanel from './VerificationPanel';
import StudentChangeTimeline from './StudentChangeTimeline';
import { ClassroomPage, Feedback, LoadingState, SectionPanel } from './ui';
export default function ClassroomStudentDetail({ studentId }: { studentId: string }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const client = useQueryClient();
  const student = useQuery({ queryKey: ['classroom', 'student', studentId, user?.id, user?.role, user?.classroomStatus, user?.credentialVersion], enabled: !!user, queryFn: ({ signal }) => fetchApi<DirectoryStudent>('/api/classroom/students/' + encodeURIComponent(studentId), { signal }), staleTime: 0 });
  const saved = () => { setEditing(false); void student.refetch(); void client.invalidateQueries({ queryKey: ['classroom', 'student-history', studentId] }); void client.invalidateQueries({ queryKey: ['classroom', 'students'] }); void client.invalidateQueries({ queryKey: ['classroom', 'classes'] }); void client.invalidateQueries({ queryKey: ['classroom', 'roster'] }); };
  const record = student.data;
  return <ClassroomPage title={record ? `${record.lastName}, ${record.firstName}${record.middleName ? ' ' + record.middleName : ''}` : 'Student profile'} eyebrow="Official student record" description="Shared profile information and verification for this student." breadcrumbs={[{ label: 'Students', href: '/class/students' }, { label: 'Student profile' }]} actions={record ? <Button variant="outline" onClick={() => setEditing(true)}><FilePenLine aria-hidden className="size-4"/>Correct information</Button> : undefined}>
    {student.isLoading ? <LoadingState label="Loading student…" /> : student.isError ? <Feedback title="Student unavailable" onRetry={() => void student.refetch()}>Check your access or connection and retry.</Feedback> : record ? <>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6"><SectionPanel title="Official profile" icon={UserRound}>
          <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">{[['USN', record.usn], ['LRN', record.lrn], ['School level', record.schoolLevel], ['Year level', record.yearLevel?.replaceAll('_', ' ')], ...['SECTION', 'DEPARTMENT', 'PROGRAM', 'STRAND'].map(category => [category === 'SECTION' ? 'Official section' : category.charAt(0) + category.slice(1).toLowerCase(), record.groups.filter(group => group.category === category).map(group => group.name).join(', ')])].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-900">{value || 'Not set'}</dd></div>)}</dl><details className="text-sm"><summary className="flex min-h-12 cursor-pointer items-center text-slate-600">Advanced record details</summary><p className="break-all text-xs text-slate-500">Profile version {record.profileRevision} · Edit version {record.editVersion}</p></details>
        </SectionPanel><SectionPanel title="Class attendance" icon={ClipboardList} description="Review attendance in classes you are authorized to access."><Button asChild variant="outline"><Link href={'/class/reports?studentId=' + encodeURIComponent(studentId)}><BarChart3 aria-hidden className="size-4"/>View student attendance</Link></Button></SectionPanel></div>
        <VerificationPanel key={record.editVersion} student={record} onSaved={saved} />
      </div>
      <StudentChangeTimeline studentId={studentId} />
      {editing ? <StudentCorrectionSheet student={record} onClose={() => setEditing(false)} onSaved={saved} /> : null}
    </> : null}
  </ClassroomPage>;
}
