import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdtempSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {Client} from 'pg';
import {getPgPoolConfig,isLocalPostgresUrl} from '../../globals/libs/dbConfig';
import {takeRosterExclusiveLock} from '../../globals/utils/pgLocks';
import {validateDatabaseUrl} from './reconcile';
import {loadSetupInput} from './setup-input';
import {buildSetupPlan,type EventOptions,type SetupPlan,type SetupState} from './setup-plan';

export type SetupOptions={inputDir:string;databaseUrl:string;groupApprovals?:string;apply?:boolean;approvalReport?:string;backupConfirmed?:boolean;allowRemote?:boolean;report?:string;eventOptions?:EventOptions};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class SetupError extends Error {constructor(public code:string){super(code);}}
function save(path:string,value:unknown){const fd=openSync(path,'w',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
function reserveReport(path?:string){
 const output=path?resolve(path):join(mkdtempSync(join(tmpdir(),'uswag-setup-')),'report.json');
 let parent=dirname(output);
 while(parent!==dirname(parent)){if(existsSync(join(parent,'.git')))throw new SetupError('REPORT_MUST_BE_OUTSIDE_REPOSITORY');parent=dirname(parent);}
 const fd=openSync(output,'wx',0o600);closeSync(fd);return output;
}
async function readState(client:Client,options:EventOptions):Promise<SetupState>{
 const groups=(await client.query('SELECT * FROM "Group" ORDER BY id')).rows;
 const students=(await client.query(`SELECT s.*, COALESCE((SELECT json_agg(g ORDER BY g.id) FROM "_GroupToStudent" j JOIN "Group" g ON g.id=j."A" WHERE j."B"=s.id),'[]'::json) AS groups FROM "Student" s ORDER BY s.id`)).rows;
 const memberships=(await client.query('SELECT * FROM "CustomGroupMembership" ORDER BY "studentId","groupId"')).rows;
 const events=(await client.query(`SELECT e.*, ARRAY(SELECT "B" FROM "_EventGroups" WHERE "A"=e.id ORDER BY "B") AS "groupIds" FROM "Event" e ORDER BY e.id`)).rows;
 const owners=options.create?(await client.query('SELECT id,role,status,"mustChangePassword","credentialVersion" FROM "User" WHERE id=$1 ORDER BY id',[options.create.ownerId])).rows:[];
 return {groups,students,memberships,events,owners};
}
async function applyPlan(client:Client,plan:SetupPlan){
 const ids=new Map<string,string>();
 for(const group of plan.groups){
  const id=group.action==='create'?randomUUID():group.id;ids.set(group.id,id);
  if(group.action==='create')await client.query('INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ($1,$2,$3,$4,now())',[id,group.name,group.slug,group.category]);
 }
 for(const student of plan.students){
  const id=student.action==='create'?randomUUID():student.id;ids.set(student.id,id);const s=student.student;
  const values=[id,s.usn||null,s.lrn||null,s.firstName,s.lastName,s.middleName||null,s.schoolLevel||null,s.yearLevel||null];
  if(student.action==='create')await client.query('INSERT INTO "Student" (id,usn,lrn,"firstName","lastName","middleName","schoolLevel","yearLevel","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',values);
  else if(student.action==='update')await client.query('UPDATE "Student" SET usn=$2,lrn=$3,"firstName"=$4,"lastName"=$5,"middleName"=$6,"schoolLevel"=$7,"yearLevel"=$8,"updatedAt"=now() WHERE id=$1',values);
  for(const slug of student.groupSlugs){
   const group=plan.groups.find(g=>g.slug===slug);
   const groupId=group?ids.get(group.id):undefined;
   // Blank optional fields may preserve an existing group outside the source catalog.
   if(groupId)await client.query('INSERT INTO "_GroupToStudent" ("A","B") VALUES ($1,$2) ON CONFLICT DO NOTHING',[groupId,id]);
  }
 }
 for(const membership of plan.memberships){
  const group=plan.groups.find(g=>g.slug===membership.groupSlug)!;const values=[ids.get(membership.studentId),ids.get(group.id),membership.position];
  if(membership.action==='create')await client.query('INSERT INTO "CustomGroupMembership" ("studentId","groupId",position,"updatedAt") VALUES ($1,$2,$3,now())',values);
  else if(membership.action==='set-position')await client.query('UPDATE "CustomGroupMembership" SET position=$3,"updatedAt"=now() WHERE "studentId"=$1 AND "groupId"=$2',values);
 }
 if(plan.event.action==='create'){
  const e=plan.event.create!;const eventId=randomUUID();
  await client.query('INSERT INTO "Event" (id,title,location,category,start,"end",status,"createdById","updatedAt") VALUES ($1,$2,$3,\'CUSTOM\',$4,$5,\'DRAFT\',$6,now())',[eventId,e.title,e.location,e.start,e.end,e.ownerId]);
  for(const group of plan.groups.filter(g=>g.category==='CUSTOM'))await client.query('INSERT INTO "_EventGroups" ("A","B") VALUES ($1,$2)',[eventId,ids.get(group.id)]);
 }
}

/** Explicit-target entry point. Never loads dotenv or connects to an implicit URL. */
export async function executeSetup(options:SetupOptions){
 let expected:ReturnType<typeof validateDatabaseUrl>;
 try{expected=validateDatabaseUrl(options.databaseUrl,options.allowRemote);}catch{throw new SetupError('INVALID_EXPLICIT_DATABASE_TARGET');}
 if(options.apply&&(!options.approvalReport||!options.backupConfirmed))throw new SetupError('APPLY_REQUIRES_REVIEW_AND_BACKUP_CONFIRMATION');
 const input=loadSetupInput(options.inputDir,options.groupApprovals);
 const eventOptions=options.eventOptions??{};
 const reportPath=reserveReport(options.report);
 let client:Client|undefined;let transaction=false;let committing=false;let committed=false;
 let report:Record<string,unknown>={mode:options.apply?'apply':'dry-run',outcome:'not-started',generatedAt:new Date().toISOString(),inputHashes:input.hashes,reportPath};
 save(reportPath,report);
 try{
  client=new Client({...getPgPoolConfig(options.databaseUrl),connectionTimeoutMillis:10000});
  // Client errors are handled by pending queries and the conservative outcome below.
  client.on('error',()=>undefined);
  await client.connect();
  const identity=(await client.query(`SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`)).rows[0];
  const stream=(client as unknown as {connection:{stream:{remoteAddress?:string;remotePort?:number;encrypted?:boolean;authorized?:boolean}}}).connection.stream;
  if(identity.database!==expected.database||stream.remotePort!==expected.port||(isLocalPostgresUrl(options.databaseUrl)?!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(stream.remoteAddress??''):!stream.encrypted||!stream.authorized))throw new SetupError('DATABASE_ENDPOINT_VERIFICATION_FAILED');
  const target={...expected,...identity};
  await client.query(options.apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
  await client.query("SET LOCAL lock_timeout='15s'");await client.query("SET LOCAL statement_timeout='60s'");
  if(options.apply){
   // Authorization row before roster, matching application lock ordering.
   if(eventOptions.create)await client.query('SELECT id FROM "User" WHERE id=$1 FOR SHARE',[eventOptions.create.ownerId]);
   const c=client;const raw=(parts:TemplateStringsArray,...values:unknown[])=>c.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
   await takeRosterExclusiveLock({$queryRaw:raw,$executeRaw:raw});
   // A maintenance batch is only 94 rows. Freeze these tables to protect absence
   // checks and fingerprints even from writers that bypass the advisory protocol.
   await client.query('LOCK TABLE "Group","Student","CustomGroupMembership","_GroupToStudent","Event","_EventGroups" IN SHARE ROW EXCLUSIVE MODE');
  }
  const state=await readState(client,eventOptions);const plan=buildSetupPlan(input,state,eventOptions);
  const fingerprint=hash({version:1,hashes:input.hashes,target,state,plan,eventOptions});
  report={...report,...plan,target,fingerprint,outcome:plan.blockers.length?'blocked':'planned'};save(reportPath,report);
  if(options.apply){
   let approved:{mode?:string;outcome?:string;fingerprint?:string};
   try{approved=JSON.parse(readFileSync(resolve(options.approvalReport!),'utf8'));}catch{throw new SetupError('INVALID_APPROVAL_REPORT');}
   if(approved.mode!=='dry-run'||approved.fingerprint!==fingerprint)throw new SetupError('STALE_REVIEW');
   if(plan.blockers.length||approved.outcome!=='planned')throw new SetupError('BLOCKED_PLAN');
   await applyPlan(client,plan);
   report={...report,outcome:'commit-pending'};save(reportPath,report);committing=true;
  }
  const completion=await client.query('COMMIT');
  if(completion.command!=='COMMIT')throw new SetupError('COMMIT_NOT_CONFIRMED');
  transaction=false;committed=!!options.apply;
  const result={...plan,mode:options.apply?'apply':'dry-run',outcome:options.apply?'committed':plan.blockers.length?'blocked':'planned',target,fingerprint,inputHashes:input.hashes,reportPath,generatedAt:report.generatedAt};
  save(reportPath,result);return result;
 }catch(error){
  let outcome=committed?'committed-report-failed':committing?'unknown-commit':'not-applied';
  if(transaction&&!committing){try{await client!.query('ROLLBACK');outcome='rolled-back';}catch{outcome='rollback-unconfirmed';}}
  const code=outcome==='rollback-unconfirmed'?'APPLY_ROLLBACK_UNCONFIRMED':error instanceof SetupError?error.code:options.apply?'APPLY_ROLLED_BACK':'SETUP_FAILED';
  try{save(reportPath,{...report,outcome,errorCode:code});}catch{/* A previously synced commit-pending report remains recovery evidence. */}
  if(committing||committed)throw new SetupError(committed?'COMMITTED_REPORT_FAILED':'COMMIT_OUTCOME_UNKNOWN');
  throw new SetupError(code);
 }finally{await client?.end().catch(()=>undefined);}
}
