import { redirect } from 'next/navigation';
import { prisma } from '@/globals/libs/prisma';
import { AuthError } from '@/globals/utils/authError';
import { requireClassroomActor } from '@/features/classroom/server/http';
import { loadAuthorizedClassroomReport } from '@/features/classroom/server/reports';
import { reportReturnPath } from '@/features/classroom/utils/reportNavigation';
import { buildClassroomReport } from '@/features/classroom/utils/reportProjection';
import ClassroomRegisterPrint from '@/features/classroom/components/reports/ClassroomRegisterPrint';
import ClassroomPrintSheet from '@/features/classroom/components/reports/ClassroomPrintSheet';
import ClassroomPrintControls from '@/features/classroom/components/reports/ClassroomPrintControls';
export const dynamic='force-dynamic';
export default async function ClassroomPrintPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;let snapshot;
 try{const actor=await requireClassroomActor();snapshot=await loadAuthorizedClassroomReport(prisma,actor,params,{purpose:'PRINT'});}
 catch(error){if(error instanceof AuthError){if(error.status===401)redirect('/login?workspace=CLASS');return <main className="mx-auto max-w-xl space-y-4 p-6" role="alert"><h1 className="text-xl font-semibold">{error.code==='REPORT_CHANGED'?'Report changed':'Report unavailable'}</h1><p>{error.message}</p><a className="flex min-h-12 items-center text-indigo-700 underline" href={reportReturnPath(params)}>Return to reports and prepare again</a></main>;}return <main className="p-6" role="alert">Unable to prepare this report. Check the selection and return to Reports.</main>;}
 const report=buildClassroomReport(snapshot);return <><ClassroomPrintControls/>{params.view==='class'?<ClassroomRegisterPrint report={report}/>:<ClassroomPrintSheet report={report}/>}</>;
}
