import ClassroomStudentDetail from '@/features/classroom/components/ClassroomStudentDetail';
export default async function StudentPage({params}:{params:Promise<{studentId:string}>}){const {studentId}=await params;return <ClassroomStudentDetail studentId={studentId}/>;}
