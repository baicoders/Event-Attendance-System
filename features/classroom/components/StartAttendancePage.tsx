'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/globals/contexts/AuthContext';
import { Button } from '@/globals/components/shad-cn/button';
import StartAttendanceSheet from './StartAttendanceSheet';
import { ClassroomPage, SectionPanel, LoadingState } from './ui';
export default function StartAttendancePage({classId}:{classId:string}) {
  const router=useRouter();
  const {user,isLoading}=useAuth();
  if(isLoading||!user)return <ClassroomPage title="Start attendance"><LoadingState label="Checking attendance access…"/></ClassroomPage>;
  if(user.role==='ADMIN')return <ClassroomPage title="Attendance is started by the teacher" eyebrow="Class administration"><SectionPanel title="Review class attendance"><p className="text-sm text-slate-600">Administrators can view existing sessions and assist with corrections. Open the class to review its session history.</p><Button asChild variant="outline"><Link href={'/class/admin/classes/'+encodeURIComponent(classId)}>Open class</Link></Button></SectionPanel></ClassroomPage>;
  return <StartAttendanceSheet classId={classId} onClose={()=>router.replace('/class/classes/'+encodeURIComponent(classId))}/>;
}
