/** Serial release regressions. Every database fixture provisions an explicit test database. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,openSync,closeSync,existsSync,readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
assert.ok(process.env.TEST_DATABASE_URL,'Explicit disposable-database maintenance URL required.');
const target=new URL(process.env.TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.searchParams.get('host')||target.hostname)&&target.pathname==='/postgres','Release regression fixtures require loopback maintenance /postgres.');
const directory='.superpowers/classroom-regression/'+randomUUID();mkdirSync(directory,{recursive:true});
const maintenancePool=new Pool({connectionString:process.env.TEST_DATABASE_URL});let serverMajor;try{serverMajor=Math.floor(Number((await maintenancePool.query('SHOW server_version_num')).rows[0].server_version_num)/10000);}finally{await maintenancePool.end();}
const tool=name=>existsSync('/usr/lib/postgresql/'+serverMajor+'/bin/'+name)?'/usr/lib/postgresql/'+serverMajor+'/bin/'+name:name;
const env={...process.env,CLASSROOM_TEST_BROWSER:'true',MANUAL_BROWSER_TEST:'1',BROWSER:'1',E2E_SKIP_BUILD:'1',BACKUP_PG_DUMP_PATH:process.env.BACKUP_PG_DUMP_PATH??tool('pg_dump'),BACKUP_PG_RESTORE_PATH:process.env.BACKUP_PG_RESTORE_PATH??tool('pg_restore')};
const suites=[
 ['classroom-api','pnpm test:classroom:api'],
 ['classroom-students','pnpm test:classroom:students'],
 ['classroom-roster-api','node --import tsx scripts/test-classroom-rosters-api.mjs'],
 ['classroom-onboarding-api','node --import tsx scripts/test-classroom-onboarding-api.mjs'],
 ['classroom-session-api','node --import tsx scripts/test-classroom-sessions-api.mjs'],
 ['classroom-attendance-api','node --import tsx scripts/test-classroom-attendance-api.mjs'],
 ['classroom-mobile','pnpm test:classroom:mobile'],
 ['classroom-report-api','node --import tsx scripts/test-classroom-reports-api.mjs'],
 ['classroom-workspaces','node --import tsx scripts/test-classroom-workspaces.mjs'],
 ['events-operator','pnpm test:operator'],['events-operator-api','pnpm test:operator-api'],
 ['events-progress','pnpm test:progress'],['events-progress-api','pnpm test:progress-api'],
 ['account-recovery','pnpm test:account-recovery'],['student-import','pnpm test:student-import'],
 ['student-import-durability','pnpm test:student-import-durability'],['duplicate-event','pnpm test:duplicate-event'],
 ['backup','pnpm test:backup'],['db-config','pnpm test:db-config'],['db-tls','pnpm test:db-tls'],
 ['uswag','pnpm test:uswag'],
 ['events-explicit-units','node --conditions=react-server --import dotenv/config --import tsx --test features/attendance/server/correctAttendance.test.ts globals/utils/student*.test.ts features/students/utils/qr*.test.ts globals/utils/groupDelete.test.ts globals/utils/eventReport.test.ts features/reports/utils/*.test.ts && node --import dotenv/config --import tsx --test features/students/components/StudentQRCard.test.ts features/reports/components/print/AttendanceSheet.test.ts'],
 ['student-identifiers-api','node --import tsx scripts/test-student-identifiers-api.mjs'],
 ['student-detail','node --import tsx scripts/test-student-detail.mjs --browser'],['student-bulk','node --import tsx scripts/test-student-bulk.mjs --browser'],
 ['custom-groups','node --import tsx scripts/test-custom-groups.mjs'],['attendance-corrections','node --import tsx scripts/test-attendance-corrections.mjs'],
 ['events-reports','pnpm test:events:reports'],['events-https-e2e','pnpm test:e2e:attendance']
];
const selected=process.env.CLASSROOM_REGRESSION_ONLY?.split(',');
function verifyArtifact(){const manifest=JSON.parse(readFileSync('.next/routes-manifest.json','utf8'));assert.ok(Array.isArray(manifest.dataRoutes)&&Array.isArray(manifest.dynamicRoutes),'Production routes manifest is incomplete. Stop HTTP tests and rebuild with no live app or parallel build.');}
verifyArtifact();const report={startedAt:new Date().toISOString(),directory,suites:[]};
for(const [name,command] of suites){if(selected&&!selected.includes(name))continue;verifyArtifact();console.log('START '+name);const fd=openSync(directory+'/'+name+'.log','w');const started=Date.now();const result=spawnSync('/bin/bash',['-c',command],{env,stdio:['ignore',fd,fd],timeout:20*60*1000});closeSync(fd);report.suites.push({name,command,exitCode:result.status,signal:result.signal,error:result.error?.message,milliseconds:Date.now()-started});writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));verifyArtifact();console.log((result.status===0?'PASS ':'FAIL ')+name+' '+Math.round((Date.now()-started)/1000)+'s');}
report.finishedAt=new Date().toISOString();writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));console.log('Evidence: '+directory+'/report.json');if(report.suites.some(s=>s.exitCode!==0))process.exitCode=1;
