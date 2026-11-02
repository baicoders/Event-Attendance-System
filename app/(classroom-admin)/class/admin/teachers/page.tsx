import PageHeader from '@/globals/components/shared/PageHeader';
import { page } from '@/globals/constants/designTokens';
import TeacherAccessAdmin from '@/features/classroom/components/TeacherAccessAdmin';
export default function TeacherAccessAdminPage() {
  return <div className={page.surface}><div className={page.container}><PageHeader eyebrow="Class administration" title="Teacher Access" description="Review applications and manage Classroom access independently of Events." /><TeacherAccessAdmin /></div></div>;
}
