import ClassroomTeacherDetail from '@/features/classroom/components/admin/ClassroomTeacherDetail';
export default async function TeacherDetailPage({params}:{params:Promise<{userId:string}>}){return <ClassroomTeacherDetail userId={(await params).userId}/>;}
