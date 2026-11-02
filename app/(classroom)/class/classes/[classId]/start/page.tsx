import StartAttendancePage from '@/features/classroom/components/StartAttendancePage';
export default async function StartPage({params}:{params:Promise<{classId:string}>}){return <StartAttendancePage classId={(await params).classId}/>;}
