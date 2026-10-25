import { classifyStudentImport } from '../../features/students/import/classify';
import { IMPORT_GROUP_FIELDS, type CanonicalRow, type ExistingImportStudent, type ImportGroup } from '../../features/students/import/contract';
import { EXPECTED, customGroupSlug } from './reconcile';
import type { SetupInput } from './setup-input';
import {eventSchema} from '../../globals/schemas';
import {planUswagBaseline,type BaselineUser} from './setup-baseline';

export type SetupEvent = {id:string;title:string;category:string;status:string;groupIds:string[];start:string;end:string;location:string|null;createdById:string|null;allDay?:boolean;reviewedById?:string|null;reviewedAt?:string|null;recordCount?:number};
export type SetupOwner = {id:string;role:string;status:string;mustChangePassword:boolean;credentialVersion:number};
export type EventOptions = {id?:string;create?:{title:string;start:string;end:string;location:string;ownerId:string}};
export type SetupState = {groups:ImportGroup[];students:ExistingImportStudent[];memberships:Array<{studentId:string;groupId:string;position:string|null}>;events:SetupEvent[];owners:SetupOwner[];users?:BaselineUser[]};
type GroupPlan = ImportGroup & {action:'create'|'reuse'|'blocked'};
type StudentPlan = {sourceRow:number;id:string;student:CanonicalRow;groupSlugs:string[];action:'create'|'update'|'noop'|'blocked';reasons:string[]};
type MembershipPlan = {sourceRow:number;studentId:string;groupSlug:string;position:string|null;action:'create'|'set-position'|'noop'|'blocked'};
const fields=Object.keys(IMPORT_GROUP_FIELDS) as Array<keyof typeof IMPORT_GROUP_FIELDS>;
const academicCategories=new Set<string>(Object.values(IMPORT_GROUP_FIELDS));
const sameText=(a:string,b:string)=>a.normalize('NFC').trim().toLowerCase()===b.normalize('NFC').trim().toLowerCase();

/** Pure preview: no Student is ever chosen by a name, LRN, or legacy primary ID. */
export function buildSetupPlan(input:SetupInput,state:SetupState,eventOptions:EventOptions={},bootstrap=false) {
 const blockers=[...input.blockers];
 const definitions=[...input.groups,...Object.keys(EXPECTED).map(name=>({name,slug:customGroupSlug(name),category:'CUSTOM',approved:true})).filter(group=>!input.groups.some(g=>g.slug===group.slug))];
 const groups:GroupPlan[]=definitions.map(def=>{
  const existing=state.groups.find(g=>g.slug===def.slug);
  const conflictingName=state.groups.some(g=>g.id!==existing?.id&&g.category===def.category&&sameText(g.name,def.name));
  const blocked=!def.approved||conflictingName||!!existing&&(existing.category!==def.category||!sameText(existing.name,def.name));
  if(blocked)blockers.push(`GROUP_REVIEW:${def.category}:${def.slug}`);
  return {id:existing?.id??`planned:group:${def.slug}`,name:def.name,slug:def.slug,category:def.category,action:blocked?'blocked':existing?'reuse':'create'};
 });
 const vocabulary=[...state.groups];for(const group of groups)if(!vocabulary.some(g=>g.slug===group.slug))vocabulary.push(group);
 // The importer provides shared schema/blank/identity conflict rules. Unsupported
 // academic join categories are preserved separately instead of being deleted.
 const classified=classifyStudentImport({rows:input.rows.map(row=>({csvRow:row.sourceRow,student:row.student})),groups:vocabulary,
  students:state.students.map(student=>({...student,groups:student.groups.filter(g=>academicCategories.has(g.category))}))});
 const students:StudentPlan[]=classified.rows.map((row,index)=>{
  const source=input.rows[index];const exact=state.students.filter(s=>s.usn===source.student.usn);
  const selected=exact.length===1?exact[0]:undefined;
  const reasons=row.reasons.map(r=>r.code+(r.field?`:${r.field}`:''));
  const codes=[source.student.usn,source.student.lrn].filter(Boolean);
  if(exact.length>1||state.students.some(s=>codes.some(code=>[s.id,s.usn,s.lrn].includes(code))&&s.id!==selected?.id))reasons.push('EXACT_USN_CONFLICT');
  if(row.student.id&&row.student.id!==selected?.id)reasons.push('EXACT_USN_REQUIRED');
  for(const field of fields) {
   const existing=selected?.groups.filter(g=>g.category===IMPORT_GROUP_FIELDS[field])??[];
   if(existing.length>1||source.student[field]&&existing.some(g=>g.slug!==source.student[field]))reasons.push(`EXISTING_ACADEMIC_CONFLICT:${field}`);
   if(source.student[field]&&groups.find(g=>g.slug===source.student[field])?.action==='blocked')reasons.push(`UNAPPROVED_GROUP:${field}`);
  }
  for(const field of ['schoolLevel','yearLevel'] as const)if(selected?.[field]&&source.student[field]&&selected[field]!==source.student[field])reasons.push(`EXISTING_ACADEMIC_CONFLICT:${field}`);
  if(reasons.length)blockers.push(`STUDENT_REVIEW:row-${source.sourceRow}:${[...new Set(reasons)].join(',')}`);
  return {sourceRow:source.sourceRow,id:selected?.id??`planned:student:${source.sourceRow}`,student:row.student,groupSlugs:fields.map(field=>row.student[field]).filter(Boolean),
   action:reasons.length?'blocked':!selected?'create':row.status==='UNCHANGED'?'noop':'update',reasons};
 });
 const memberships:MembershipPlan[]=input.rows.map((source,index)=>{
  const student=students[index];const groupSlug=customGroupSlug(source.group);const group=groups.find(g=>g.slug===groupSlug)!;
  const existing=state.memberships.filter(m=>m.studentId===student.id);
  const current=existing.find(m=>m.groupId===group.id);
  let action:MembershipPlan['action']='create';
  if(student.action==='blocked'||group.action==='blocked'||existing.some(m=>m.groupId!==group.id))action='blocked';
  else if(current) {
   if((current.position??'')===(source.position??'')||!source.position)action='noop';
   else if(!current.position)action='set-position';else action='blocked';
  }
  if(action==='blocked')blockers.push(`MEMBERSHIP_REVIEW:row-${source.sourceRow}`);
  return {sourceRow:source.sourceRow,studentId:student.id,groupSlug,position:source.position??current?.position??null,action};
 });
 const intendedGroups=groups.filter(g=>g.category==='CUSTOM');
 const projectedMemberships=[...state.memberships];
 for(const m of memberships)if(m.action==='create')projectedMemberships.push({studentId:m.studentId,groupId:intendedGroups.find(g=>g.slug===m.groupSlug)!.id,position:m.position});
 const expectedIds=new Set(students.map(s=>s.id));
 const candidates=state.events.filter(e=>/\buswag\b/i.test(e.title)||e.title===eventOptions.create?.title);
 const selected=eventOptions.id?state.events.find(e=>e.id===eventOptions.id):candidates.length===1?candidates[0]:undefined;
 const eventReasons:string[]=[];let eventAction:'none'|'reuse'|'create'|'approve'|'blocked'='none';let extraStudents=0;let missingStudents=0;
 if(eventOptions.id&&!selected)eventReasons.push('EVENT_NOT_FOUND');
 if(!eventOptions.id&&candidates.length>1)eventReasons.push('EVENT_SELECTION_REQUIRED');
 if(selected){
  eventAction='reuse';const actualGroupIds=new Set(selected.groupIds);const intended=new Set(intendedGroups.map(g=>g.id));
  if(selected.category!=='CUSTOM'||actualGroupIds.size!==intended.size||[...intended].some(id=>!actualGroupIds.has(id)))eventReasons.push('EVENT_GROUP_SCOPE_MISMATCH');
  const eligible=new Set(projectedMemberships.filter(m=>actualGroupIds.has(m.groupId)).map(m=>m.studentId));
  extraStudents=[...eligible].filter(id=>!expectedIds.has(id)).length;missingStudents=[...expectedIds].filter(id=>!eligible.has(id)).length;
  if(extraStudents||missingStudents)eventReasons.push('EVENT_ROSTER_MISMATCH');
  if(selected.status!=='APPROVED')eventReasons.push('EVENT_AWAITS_APPROVAL');
  if(eventOptions.create)eventReasons.push('EVENT_ALREADY_EXISTS');
 }else if(eventOptions.create&&!eventReasons.length){
  const c=eventOptions.create;const owner=state.owners.find(o=>o.id===c.ownerId);
  if(!owner||owner.status!=='ACTIVE'||owner.mustChangePassword||!['ADMIN','ORGANIZER'].includes(owner.role))blockers.push('EVENT_OWNER_UNAUTHORIZED');
  const schema=eventSchema.safeParse({...c,category:'CUSTOM',includedGroups:intendedGroups.map(g=>g.id),description:null,allDay:false,start:new Date(c.start),end:new Date(c.end)});
  if(!schema.success||!c.location?.trim()||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.start)||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.end)||Date.parse(c.end)<=Date.parse(c.start))blockers.push('EVENT_SCHEDULE_INVALID');
  eventAction='create';eventReasons.push('EVENT_DRAFT_REQUIRES_SUBMISSION_AND_APPROVAL');
 }else if(!eventReasons.length)eventReasons.push('EVENT_SCHEDULE_AND_OWNER_REQUIRED');
 if(!selected){
  const intended=new Set(intendedGroups.map(g=>g.id));
  const eligible=new Set(projectedMemberships.filter(m=>intended.has(m.groupId)).map(m=>m.studentId));
  extraStudents=[...eligible].filter(id=>!expectedIds.has(id)).length;missingStudents=[...expectedIds].filter(id=>!eligible.has(id)).length;
  if(extraStudents||missingStudents)eventReasons.push('EVENT_ROSTER_MISMATCH');
 }
 if(blockers.length)eventReasons.push('ROSTER_SETUP_BLOCKED');
 const baseline=bootstrap?planUswagBaseline(state.users??[],state.events,groups):undefined;
 if(baseline){
  blockers.push(...baseline.blockers);
  const finalGroups=new Set(baseline.event.groupIds);
  const eligible=new Set(projectedMemberships.filter(m=>finalGroups.has(m.groupId)).map(m=>m.studentId));
  extraStudents=[...eligible].filter(id=>!expectedIds.has(id)).length;missingStudents=[...expectedIds].filter(id=>!eligible.has(id)).length;
  if(extraStudents)blockers.push('BASELINE_EVENT_EXTRA_MEMBERS');
  if(missingStudents)blockers.push('BASELINE_EVENT_MISSING_MEMBERS');
 }
 const readiness=blockers.length||eventReasons.some(r=>['EVENT_NOT_FOUND','EVENT_SELECTION_REQUIRED','EVENT_GROUP_SCOPE_MISMATCH','EVENT_ROSTER_MISMATCH','EVENT_ALREADY_EXISTS'].includes(r))?'blocked':!selected&&!eventOptions.create?'missing-inputs':eventReasons.length?'awaiting-approval':'ready';
 const event={action:eventAction as 'none'|'reuse'|'create'|'approve'|'blocked',id:selected?.id,create:eventOptions.create,readiness,reasons:eventReasons,extraStudents,missingStudents};
 if(baseline){event.action=baseline.event.action;event.id=baseline.event.id;event.readiness=blockers.length?'blocked':'ready';event.reasons=blockers.length?['BASELINE_SETUP_BLOCKED']:[];}
 return {groups,students,memberships,held:input.held,blockers,event,baseline,
  counts:{sourceRows:input.rows.length+input.held.length,approved:input.rows.length,held:input.held.length,groupsCreated:groups.filter(g=>g.action==='create').length,groupsReused:groups.filter(g=>g.action==='reuse').length,studentsCreated:students.filter(s=>s.action==='create').length,studentsUpdated:students.filter(s=>s.action==='update').length,studentsUnchanged:students.filter(s=>s.action==='noop').length,membershipsCreated:memberships.filter(m=>m.action==='create').length,positionsUpdated:memberships.filter(m=>m.action==='set-position').length,membershipsUnchanged:memberships.filter(m=>m.action==='noop').length,accountsCreated:baseline?.users.filter(u=>u.action==='create').length??0,accountsReused:baseline?.users.filter(u=>u.action==='reuse').length??0,blockers:blockers.length},
  groupCounts:Object.keys(EXPECTED).map(group=>({group,approved:input.rows.filter(row=>row.group===group).length}))};
}
export type SetupPlan=ReturnType<typeof buildSetupPlan>;
