import ClassroomClassPage from '@/features/classroom/components/ClassroomClassPage';
export default async function ClassPage({params}:{params:Promise<{classId:string}>}){const {classId}=await params;return <ClassroomClassPage classId={classId} admin mode="settings"/>;}
