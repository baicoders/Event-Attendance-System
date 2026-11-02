import SessionAttendancePage from '@/features/classroom/components/SessionAttendancePage';
export default async function AttendanceSessionPage({params}:{params:Promise<{sessionId:string}>}){return <SessionAttendancePage key={(await params).sessionId} sessionId={(await params).sessionId}/>;}
