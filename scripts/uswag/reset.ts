/** Explicit destructive local reset, followed by the same approved setup. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {getPgPoolConfig} from '../../globals/libs/dbConfig';
import {SetupError} from './setup-db';
import {loadSetupInput} from './setup-input';
import {validateDatabaseUrl} from './reconcile';
import {loadLocalSetupOptions,runApprovedLocalSetup} from './setup-local';

const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
const LOCAL_ADDRESSES=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export function validateResetTarget(databaseUrl:string):{database:string;port:number}{
 const refused=()=>{throw new SetupError('USWAG_RESET_TARGET_REFUSED');};
 // Reset and subsequent setup must accept precisely the same selected URL.
 try{validateDatabaseUrl(databaseUrl);}catch{return refused();}
 let url:URL;try{url=new URL(databaseUrl);}catch{return refused();}
 if(databaseUrl!==databaseUrl.trim()||!['postgres:','postgresql:'].includes(url.protocol)||!LOCAL_HOSTS.has(url.hostname)||url.hash)return refused();
 // No percent-encoded names, nested paths or driver-specific target overrides.
 const database=url.pathname.slice(1);
 if(database!=='event_attendance_dev'&&!/^test_uswag_[a-zA-Z0-9_]+$/.test(database))return refused();
 const seen=new Set<string>();
 for(const [key,value] of url.searchParams){
  if(seen.has(key))return refused();seen.add(key);
  if(key==='connect_timeout'&&/^\d+$/.test(value))continue;
  if(key==='sslmode'&&['disable','prefer','require'].includes(value))continue;
  return refused();
 }
 return {database,port:Number(url.port||5432)};
}

export function assertResetConnection(
 target:{database:string;port:number},
 actual:{database:string;template:boolean}|undefined,
 peer:{remoteAddress?:string;remotePort?:number},
):void{
 // A local Docker port forward has an internal server address/port. Verify
 // the actual client socket endpoint, as the approved setup does.
 if(!actual||actual.database!==target.database||actual.template!==false||peer.remotePort!==target.port||!LOCAL_ADDRESSES.has(peer.remoteAddress??'')){
  throw new SetupError('USWAG_RESET_CONNECTED_TARGET_REFUSED');
 }
}

export async function runApprovedLocalReset(){
 const options=loadLocalSetupOptions();
 const target=validateResetTarget(options.databaseUrl);
 // Validate all private source files and approvals before destroying any state.
 const input=loadSetupInput(options.inputDir,options.groupApprovals);
 if(input.blockers.length)throw new SetupError('USWAG_RESET_INPUT_BLOCKED');
 const client=new Client({...getPgPoolConfig(options.databaseUrl),connectionTimeoutMillis:5000});
 try{
  await client.connect();
  const {rows:[actual]}=await client.query(`SELECT current_database() AS database, inet_server_addr()::text AS address,
   inet_server_port() AS port, datistemplate AS template FROM pg_database WHERE datname=current_database()`);
  const peer=(client as unknown as {connection:{stream:{remoteAddress?:string;remotePort?:number}}}).connection.stream;
  assertResetConnection(target,actual,peer);
 }finally{await client.end();}
 const ownRequire=createRequire(import.meta.url);
 const prismaPackage=ownRequire('prisma/package.json') as {version:string};
 // Prisma 7 never auto-seeds during migrate reset; fail closed on older CLIs.
 if(!prismaPackage.version.startsWith('7.'))throw new SetupError('USWAG_RESET_REQUIRES_PRISMA_7');
 const prismaCli=join(dirname(ownRequire.resolve('prisma/package.json')),'build','index.js');
 // Both runtime and migration config must use precisely the validated target.
 process.env.DATABASE_URL=options.databaseUrl;process.env.DIRECT_URL=options.databaseUrl;
 try{
  execFileSync(process.execPath,[prismaCli,'migrate','reset','--force'],{
   cwd:process.cwd(),env:{...process.env,DATABASE_URL:options.databaseUrl,DIRECT_URL:options.databaseUrl},
   stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024,
  });
 }catch{throw new SetupError('USWAG_RESET_MIGRATION_FAILED');}
 const result=await runApprovedLocalSetup();
 console.log(JSON.stringify({mode:'reset',outcome:result.outcome,counts:result.counts,groupCounts:result.groupCounts,
  eventReadiness:result.event.readiness,fingerprint:result.fingerprint,report:result.reportPath},null,2));
 if(result.outcome==='blocked')throw new SetupError('USWAG_RESET_SETUP_BLOCKED',result.reportPath);
 return result;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 (async()=>{
  if(process.argv.length!==2)throw new SetupError('USWAG_RESET_ACCEPTS_NO_OPTIONS');
  await runApprovedLocalReset();
 })().catch(error=>{
  // Never expose connection strings, private source values, or raw child output.
  console.error(error instanceof SetupError?error.code:'USWAG_RESET_INPUT_OR_CONNECTION_FAILED');
  process.exitCode=1;
 });
}
