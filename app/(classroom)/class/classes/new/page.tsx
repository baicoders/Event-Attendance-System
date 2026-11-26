import { ClassroomPage } from '@/features/classroom/components/ui';
import ClassForm from '@/features/classroom/components/ClassForm';
export default function NewClassPage(){return <ClassroomPage title="Create a class" eyebrow="Class setup" description="Save the basics, choose your sections, then review the roster." breadcrumbs={[{label:'My Classes',href:'/class/classes'},{label:'Create class'}]}><ClassForm/></ClassroomPage>;}
