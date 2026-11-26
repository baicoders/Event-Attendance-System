import { ClassroomPage } from '@/features/classroom/components/ui';
import ClassForm from '@/features/classroom/components/ClassForm';
export default function NewClassPage(){return <ClassroomPage title="Create class for a teacher" eyebrow="Class administration" description="Save the basics, choose your sections, then review the roster." breadcrumbs={[{label:'Class administration',href:'/class/admin/classes'},{label:'Create class'}]}><ClassForm basePath="/class/admin/classes"/></ClassroomPage>;}
