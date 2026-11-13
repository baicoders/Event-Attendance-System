'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/globals/contexts/AuthContext';
import { Button } from '@/globals/components/shad-cn/button';
import StartAttendanceSheet from './StartAttendanceSheet';
export default function StartAttendancePage({classId}:{classId:string}) {
  const router=useRouter();
  const {user,isLoading}=useAuth();
  if(isLoading||!user)return <p role="status" className="p-6 text-sm text-slate-600">Checking attendance access…</p>;
  if(user.role==='ADMIN')return <section className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-semibold text-slate-900">Attendance is started by the teacher</h1><p className="text-sm text-slate-600">Administrators can view existing sessions and assist with corrections. Open the class to review its session history.</p><Button asChild variant="outline"><Link href={'/class/admin/classes/'+encodeURIComponent(classId)}>Open class</Link></Button></section>;
  return <StartAttendanceSheet classId={classId} onClose={()=>router.replace('/class/classes/'+encodeURIComponent(classId))}/>;
}
