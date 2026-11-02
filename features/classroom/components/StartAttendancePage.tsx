'use client';
import { useRouter } from 'next/navigation';
import StartAttendanceSheet from './StartAttendanceSheet';
export default function StartAttendancePage({classId}:{classId:string}){const router=useRouter();return <StartAttendanceSheet classId={classId} onClose={()=>router.replace('/class/classes/'+encodeURIComponent(classId))}/>;}
