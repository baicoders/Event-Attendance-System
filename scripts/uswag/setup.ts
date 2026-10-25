/** One dedicated CLI; never import dotenv or the destructive demo seed. */
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {executeSetup,SetupError,type SetupOptions} from './setup-db';
const USAGE=`Usage: pnpm uswag:setup --input-dir /private/handoff --database-env USWAG_SETUP_DATABASE_URL
  [--group-approvals /private/group-approvals.json] [--event-options /private/event.json]
  [--dry-run] [--report /private/new-review.json] [--allow-remote]
  [--apply --approval-report /private/reviewed.json --backup-confirmed]
Default: read-only dry-run. One command handles academic groups, houses, students,
officer groups, memberships, positions and event readiness. Private inputs/reports
must stay outside public commits. Events are created only as owned DRAFTs.
Alternative explicit target: --database-url <postgresql-url> (avoid shell history).`;
const eventOptionsSchema=z.object({id:z.string().min(1).optional(),create:z.object({title:z.string().trim().min(1).max(200),ownerId:z.string().min(1),location:z.string().trim().min(1).max(200),start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})}).strict().optional()}).strict().refine(x=>!!x.id!==!!x.create);
function parse(argv:string[]):SetupOptions{
 const result:SetupOptions={inputDir:'',databaseUrl:''};const seen=new Set<string>();let databaseEnv:string|undefined;let eventPath:string|undefined;
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(seen.has(key))throw new SetupError('INVALID_OPTIONS');seen.add(key);
  if(key==='--apply')result.apply=true;
  else if(key==='--backup-confirmed')result.backupConfirmed=true;
  else if(key==='--allow-remote')result.allowRemote=true;
  else if(key==='--dry-run'){/* Explicit default. */}
  else if(['--input-dir','--database-env','--database-url','--group-approvals','--event-options','--report','--approval-report'].includes(key)){
   const value=argv[++i];if(!value||value.startsWith('--'))throw new SetupError('INVALID_OPTIONS');
   if(key==='--input-dir')result.inputDir=value;
   if(key==='--database-env')databaseEnv=value;
   if(key==='--database-url')result.databaseUrl=value;
   if(key==='--group-approvals')result.groupApprovals=value;
   if(key==='--event-options')eventPath=value;
   if(key==='--report')result.report=value;
   if(key==='--approval-report')result.approvalReport=value;
  }else throw new SetupError('INVALID_OPTIONS');
 }
 if(!result.inputDir||result.apply&&seen.has('--dry-run')||databaseEnv&&result.databaseUrl)throw new SetupError('INVALID_OPTIONS');
 if(databaseEnv){if(!/^[A-Z][A-Z0-9_]*$/.test(databaseEnv))throw new SetupError('INVALID_OPTIONS');result.databaseUrl=process.env[databaseEnv]??'';}
 if(!result.databaseUrl)throw new SetupError('INVALID_OPTIONS');
 if(result.apply&&(!result.approvalReport||!result.backupConfirmed))throw new SetupError('APPLY_REQUIRES_REVIEW_AND_BACKUP_CONFIRMATION');
 if(eventPath){try{result.eventOptions=eventOptionsSchema.parse(JSON.parse(readFileSync(eventPath,'utf8')));}catch{throw new SetupError('INVALID_EVENT_OPTIONS');}}
 return result;
}
async function main(){
 if(process.argv.includes('--help')){console.log(USAGE);return;}
 const result=await executeSetup(parse(process.argv.slice(2)));
 console.log(JSON.stringify({mode:result.mode,outcome:result.outcome,counts:result.counts,groupCounts:result.groupCounts,eventReadiness:result.event.readiness,fingerprint:result.fingerprint,report:result.reportPath},null,2));
 if(result.outcome==='blocked')process.exitCode=2;
}
main().catch(error=>{
 console.error(error instanceof SetupError?error.code:'SETUP_INPUT_OR_CONNECTION_FAILED');
 if(error instanceof SetupError&&error.code==='INVALID_OPTIONS')console.error(`${USAGE}\nThe command never loads .env automatically; explicitly select and populate the target environment variable.`);
 if(error instanceof SetupError&&error.reportPath)console.error(JSON.stringify({report:error.reportPath}));
 process.exitCode=1;
});
