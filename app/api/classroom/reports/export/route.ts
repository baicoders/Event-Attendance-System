import { prisma } from '@/globals/libs/prisma';
import { loadAuthorizedClassroomReport } from '@/features/classroom/server/reports';
import { buildClassroomReport } from '@/features/classroom/utils/reportProjection';
import { buildClassroomCsv } from '@/features/classroom/utils/reportExport';
import { reportQuerySchema } from '@/features/classroom/schemas/reportSchema';
import { requireClassroomActor,classroomError,PRIVATE_HEADERS } from '@/features/classroom/server/http';

export async function GET(request:Request) {
 try {
  const actor=await requireClassroomActor();
  const query=reportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const format=query.format;
  const report=buildClassroomReport(await loadAuthorizedClassroomReport(prisma,actor,query,{purpose:format==='XLSX'?'XLSX':'CSV'}));
  const headers={...PRIVATE_HEADERS,'X-Report-Version':report.reportVersion};
  const version=report.reportVersion.slice(0,12);
  if(format==='XLSX'){
   const {buildRegisterXlsx}=await import('@/features/classroom/server/registerXlsx');
   const bytes=await buildRegisterXlsx(report);
   return new Response(bytes,{headers:{...headers,
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':'attachment; filename="attendance-report-'+version+'.xlsx"'}});
  }
  return new Response(buildClassroomCsv(report,format),{headers:{...headers,
   'Content-Type':'text/csv; charset=utf-8',
   'Content-Disposition':'attachment; filename="classroom-'+format.toLowerCase()+'-'+version+'.csv"'}});
 }catch(error){return classroomError(error);}
}
