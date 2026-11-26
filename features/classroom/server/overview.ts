import 'server-only';
import type { Prisma,PrismaClient,ClassroomSession } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { classroomRead,classroomAdministrator,type ActorContext } from './access';
import { classInclude,classDto } from './classAccess';
import { attendanceProgress,sessionCountsForIds } from './sessionAccess';
import { overviewQuerySchema,overviewClassSnapshotSchema } from '../schemas/overviewSchema';
import { scheduleSchema } from '../schemas/classSchema';
import type { ClassroomOverview,OverviewMeeting,OverviewPreview } from '../types/overview';
const ACTIVE_LIMIT=5,CLASS_LIMIT=6,RECENT_LIMIT=5;
function preview<T>(items:T[],total:number,limit:number,href:string):OverviewPreview<T>{return {items,total,limit,hasMore:total>items.length,href};}
function meetingDto(row:ClassroomSession,progress:ReturnType<typeof attendanceProgress>):OverviewMeeting{
 const snapshot=overviewClassSnapshotSchema.safeParse(row.classSnapshot);
 if(!snapshot.success)throw new AuthError('This meeting has an incomplete class snapshot. Contact an administrator.',500,'INCOMPLETE_SESSION');
 return {...progress,id:row.id,classId:row.classId,state:row.state,scheduledStartAt:row.scheduledStartAt.toISOString(),startedAt:row.startedAt.toISOString(),finalizedAt:row.finalizedAt?.toISOString()??null,canceledAt:row.canceledAt?.toISOString()??null,lifecycleRevision:row.lifecycleRevision,snapshotRevision:row.snapshotRevision,classSnapshot:snapshot.data,href:'/class/sessions/'+encodeURIComponent(row.id)};
}
/** Full-scope totals and bounded teacher-home previews. Historical meetings retain archived classes. */
export async function getClassroomOverview(db:PrismaClient,actor:ActorContext,raw=new URLSearchParams(),now=new Date()):Promise<ClassroomOverview>{
 const input=overviewQuerySchema.parse(Object.fromEntries(raw));
 return classroomRead(db,actor,async(tx,user)=>{
  const classesPath=classroomAdministrator(user)?'/class/admin/classes':'/class/classes';
  const scope:Prisma.ClassOfferingWhereInput={...(!classroomAdministrator(user)?{primaryTeacherId:user.id}:{}),...(input.termId?{termId:input.termId}:{})};
  const currentClasses:Prisma.ClassOfferingWhereInput={...scope,archivedAt:null};
  const activeWhere:Prisma.ClassroomSessionWhereInput={class:scope,state:'ACTIVE'};
  const recentWhere:Prisma.ClassroomSessionWhereInput={class:scope,state:{in:['FINALIZED','CANCELED']}};
  // Manila has a fixed UTC+08 offset. Half-open boundaries avoid double counting midnight.
  const schoolDate=new Date(now.getTime()+8*60*60*1000).toISOString().slice(0,10);
  const start=new Date(schoolDate+'T00:00:00+08:00'),end=new Date(start.getTime()+86400000);
  const [classCount,activeMeetingCount,meetingsTodayCount,recentMeetingCount,activeRows,classRows,recentRows]=await Promise.all([
   tx.classOffering.count({where:currentClasses}),tx.classroomSession.count({where:activeWhere}),
   tx.classroomSession.count({where:{class:scope,state:{in:['ACTIVE','FINALIZED']},scheduledStartAt:{gte:start,lt:end}}}),
   tx.classroomSession.count({where:recentWhere}),
   tx.classroomSession.findMany({where:activeWhere,orderBy:[{scheduledStartAt:'desc'},{id:'desc'}],take:ACTIVE_LIMIT}),
   tx.classOffering.findMany({where:currentClasses,include:{...classInclude,rosterExceptions:false,sessions:{orderBy:[{scheduledStartAt:'desc'},{id:'desc'}],take:1,select:{id:true,state:true,scheduledStartAt:true}}},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:CLASS_LIMIT}),
   tx.classroomSession.findMany({where:recentWhere,orderBy:[{scheduledStartAt:'desc'},{id:'desc'}],take:RECENT_LIMIT}),
  ]);
  const counts=await sessionCountsForIds(tx,[...activeRows,...recentRows].map(row=>row.id));
  const classActive=classRows.length?await tx.classroomSession.findMany({where:{classId:{in:classRows.map(row=>row.id)},state:'ACTIVE'},select:{id:true,classId:true,scheduledStartAt:true}}):[];
  const classes=classRows.map(row=>{
   const {exceptions:_,...summary}=classDto({...row,rosterExceptions:[]});void _;
   const active=classActive.find(meeting=>meeting.classId===row.id),latest=row.sessions[0];
   return {...summary,schedule:row.schedule?scheduleSchema.parse(row.schedule):null,activeSession:active?{id:active.id,scheduledStartAt:active.scheduledStartAt.toISOString()}:null,latestSession:latest?{...latest,scheduledStartAt:latest.scheduledStartAt.toISOString()}:null};
  });
  const link=(path:string,extra:Record<string,string>={})=>{const params=new URLSearchParams({...input.termId?{termId:input.termId}:{},...extra});return path+(params.size?'?'+params.toString():'');};
  return {serverNow:now.toISOString(),timeZone:'Asia/Manila',termId:input.termId??null,stats:{classCount,activeMeetingCount,meetingsTodayCount},activeMeetings:preview(activeRows.map(row=>meetingDto(row,attendanceProgress(counts.get(row.id)!))),activeMeetingCount,ACTIVE_LIMIT,link('/class/attendance',{view:'active'})),recentClasses:preview(classes,classCount,CLASS_LIMIT,link(classesPath)),recentMeetings:preview(recentRows.map(row=>meetingDto(row,attendanceProgress(counts.get(row.id)!))),recentMeetingCount,RECENT_LIMIT,link(classesPath,{archived:'true'}))};
 });
}
