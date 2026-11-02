import PageHeader from '@/globals/components/shared/PageHeader';
import StudentDirectory from '@/features/classroom/components/StudentDirectory';
export default function StudentsPage(){return <div className="mx-auto min-w-0 max-w-6xl space-y-6 px-4 py-6 sm:px-6"><PageHeader title="Students" eyebrow="Class"/><StudentDirectory/></div>;}
