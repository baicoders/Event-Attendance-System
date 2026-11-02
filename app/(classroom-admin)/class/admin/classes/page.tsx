import ClassDashboard from '@/features/classroom/components/ClassDashboard';
export default async function AdminClassesPage({searchParams}:{searchParams:Promise<{teacherId?:string}>}){return <ClassDashboard admin teacherId={(await searchParams).teacherId}/>;}
