import { prisma } from '@/globals/libs/prisma';
import { loadAuthorizedClassroomReport } from '@/features/classroom/server/reports';
import { buildClassroomReport } from '@/features/classroom/utils/reportProjection';
import { buildClassroomCsv } from '@/features/classroom/utils/reportExport';
import { reportQuerySchema } from '@/features/classroom/schemas/reportSchema';
import { requireClassroomActor,classroomError,PRIVATE_HEADERS } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();const query=reportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));const report=buildClassroomReport(await loadAuthorizedClassroomReport(prisma,actor,query,{purpose:'CSV'}));return new Response(buildClassroomCsv(report,query.format),{headers:{...PRIVATE_HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="classroom-'+query.format.toLowerCase()+'-'+report.reportVersion.slice(0,12)+'.csv"','X-Report-Version':report.reportVersion}});}catch(error){return classroomError(error);}}
