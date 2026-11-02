import ClassroomReportsPage from '@/features/classroom/components/reports/ClassroomReportsPage';
import type { ClassroomReportFilters } from '@/features/classroom/types/report';
export default async function ReportsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const params=await searchParams;const initial:ClassroomReportFilters=Object.fromEntries(['termId','classId','sessionId','studentId','from','to'].flatMap(key=>typeof params[key]==='string'?[[key,params[key]]]:[]));return <ClassroomReportsPage initial={initial}/>;}
