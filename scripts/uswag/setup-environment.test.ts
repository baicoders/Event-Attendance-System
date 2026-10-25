import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const loader=resolve(process.env.USWAG_TEST_LOADER||'scripts/uswag/setup-local.ts'),database=resolve('globals/libs/dbConfig.ts'),reset=resolve('scripts/uswag/reset.ts');
const hosted='postgres://operator:private-hosted-secret@db.prisma.io:5432/postgres?sslmode=require';
const local='postgresql://operator:private-local-secret@127.0.0.1:5433/event_attendance_dev';
function inspect(t:{after(fn:()=>void):void},options:{shell?:string;file?:string;reset?:boolean}={}){
 const directory=mkdtempSync(join(tmpdir(),'uswag-env-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'.env'),`DATABASE_URL="${hosted}"\n`);writeFileSync(join(directory,'.env.local'),`DATABASE_URL="${local}"\n`);
 writeFileSync(join(directory,'.env.uswag-setup.json'),JSON.stringify({v:1,approved:true,inputDir:'/unused-private-input',groupApprovals:'/unused-private-approvals'}));
 const env={...process.env};for(const key of ['DATABASE_URL','DIRECT_URL','USWAG_SETUP_CONFIG','USWAG_SETUP_ENV_FILE','DATABASE_SSL_CA_BASE64','NODE_OPTIONS','__NEXT_PROCESSED_ENV'])delete env[key];
 env.TSX_TSCONFIG_PATH=resolve('tsconfig.json');
 if(options.shell!==undefined)env.DATABASE_URL=options.shell;if(options.file)env.USWAG_SETUP_ENV_FILE=options.file;
 const script=`const {loadLocalSetupOptions}=require(${JSON.stringify(loader)});const {describeDatabaseUrl,getPgPoolConfig}=require(${JSON.stringify(database)});try{const o=loadLocalSetupOptions();${options.reset?`require(${JSON.stringify(reset)}).validateResetTarget(o.databaseUrl);`:''}const ssl=getPgPoolConfig(o.databaseUrl).ssl;console.log(JSON.stringify({target:describeDatabaseUrl(o.databaseUrl),source:o.databaseSource,allowRemote:o.allowRemote,verifiedTLS:!!ssl&&ssl.rejectUnauthorized===true}));}catch(error){console.log(JSON.stringify({error:error.code||'VALIDATION_FAILED'}));}`;
 const result=spawnSync(process.execPath,['--import',require.resolve('tsx'),'-e',script],{cwd:directory,env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,/private-hosted-secret|private-local-secret|shell-secret/);
 return JSON.parse(result.stdout);
}
test('setup uses .env instead of a stale local override and permits verified hosted TLS',t=>{
 const result=inspect(t);assert.equal(result.target,'db.prisma.io:5432/postgres');assert.equal(result.source,'.env');assert.equal(result.allowRemote,true);assert.equal(result.verifiedTLS,true);
});
test('inline shell DATABASE_URL overrides the env file',t=>{
 const result=inspect(t,{shell:'postgresql://operator:shell-secret@127.0.0.1:5433/test_uswag_shell'});assert.equal(result.target,'127.0.0.1:5433/test_uswag_shell');assert.equal(result.source,'shell environment');
});
test('an explicitly selected env file supports local setup without changing the default file',t=>{
 const result=inspect(t,{file:'.env.local'});assert.equal(result.target,'127.0.0.1:5433/event_attendance_dev');assert.equal(result.source,'.env.local');
});
test('hosted setup still rejects insecure TLS and connection target overrides',t=>{
 for(const shell of [hosted.replace('sslmode=require','sslmode=disable'),hosted+'&host=127.0.0.1'])assert.equal(inspect(t,{shell}).error,'INVALID_EXPLICIT_DATABASE_TARGET');
});
test('reset refuses the hosted env target before connecting or resetting',t=>{
 assert.equal(inspect(t,{reset:true}).error,'USWAG_RESET_TARGET_REFUSED');
});
