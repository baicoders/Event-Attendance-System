import PageHeader from '@/globals/components/shared/PageHeader';
import ClassForm from '@/features/classroom/components/ClassForm';
export default function AdminNewClassPage(){return <div className="mx-auto min-w-0 max-w-3xl space-y-6 px-4 py-6 sm:px-6"><PageHeader title="Create class for a teacher" eyebrow="Class administration"/><ClassForm basePath="/class/admin/classes"/></div>;}
