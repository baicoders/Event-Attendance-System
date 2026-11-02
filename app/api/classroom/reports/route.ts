import { prisma } from '@/globals/libs/prisma';
import { loadAuthorizedClassroomReport,buildReportPage } from '@/features/classroom/server/reports';
import { buildClassroomReport } from '@/features/classroom/utils/reportProjection';
import { reportQuerySchema } from '@/features/classroom/schemas/reportSchema';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();const query=reportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));const report=buildClassroomReport(await loadAuthorizedClassroomReport(prisma,actor,query));return classroomJson(buildReportPage(report,query));}catch(error){return classroomError(error);}}
