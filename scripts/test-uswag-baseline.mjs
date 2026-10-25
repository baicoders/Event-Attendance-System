import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {Client} from 'pg';
import {createDisposableDatabase} from './pg-test-db.mjs';
import fixtureModule from './uswag/setup-fixture.test-support.ts';
import baselineModule from './uswag/setup-baseline.ts';
import qrModule from '../features/students/utils/qrIdentifier.ts';
const {createFixture}=fixtureModule;
const {USWAG_BASELINE_ACCOUNTS,USWAG_TEST_PASSWORD}=baselineModule;
const {resolveQRIdentifier}=qrModule;
const require=createRequire(import.meta.url);
const maintenance=new URL(process.env.TEST_DATABASE_URL||'invalid:');
if(!['127.0.0.1','localhost','[::1]'].includes(maintenance.hostname)||maintenance.pathname!=='/postgres')throw new Error('Explicit local TEST_DATABASE_URL ending /postgres is required.');
const directory=mkdtempSync(join(tmpdir(),'uswag-complete-baseline-'));
const fixture=createFixture(directory);
const config=join(directory,'local-setup.json');
writeFileSync(config,JSON.stringify({v:1,approved:true,inputDir:fixture.inputDir,groupApprovals:fixture.approvalsPath}),{mode:0o600});
const environment=db=>({...process.env,DATABASE_URL:db.url,DIRECT_URL:'postgresql://unused@127.0.0.1:1/must_not_be_reset',USWAG_SETUP_CONFIG:config,AUTH_SECRET:'synthetic-uswag-baseline-auth-secret-at-least-32-characters',NODE_ENV:'development'});
const command=(db,name)=>spawnSync('pnpm',['run',name],{env:environment(db),encoding:'utf8',timeout:180000});
async function query(db,sql,values=[]){const client=new Client({connectionString:db.url});await client.connect();try{return (await client.query(sql,values)).rows;}finally{await client.end();}}
const snapshot=db=>query(db,`SELECT json_build_object('users',(SELECT json_agg(u ORDER BY id) FROM "User" u),'events',(SELECT json_agg(e ORDER BY id) FROM "Event" e),'groups',(SELECT json_agg(g ORDER BY id) FROM "Group" g),'students',(SELECT json_agg(s ORDER BY id) FROM "Student" s),'memberships',(SELECT json_agg(m ORDER BY "studentId") FROM "CustomGroupMembership" m),'eventGroups',(SELECT json_agg(j ORDER BY "A","B") FROM "_EventGroups" j),'records',(SELECT json_agg(r ORDER BY id) FROM "Record" r)) AS snapshot`).then(rows=>rows[0].snapshot);
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function startServer(db){
 const port=await freePort();const base=`http://127.0.0.1:${port}`;let output='';
 mkdirSync('.next',{recursive:true});const testTsconfig=JSON.parse(readFileSync('tsconfig.json','utf8'));
 testTsconfig.compilerOptions.baseUrl='..';testTsconfig.include=['../next-env.d.ts','../**/*.ts','../**/*.tsx'];testTsconfig.exclude=['../node_modules'];
 writeFileSync('.next/uswag-test-tsconfig.json',JSON.stringify(testTsconfig));
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(port)],{env:{...environment(db),USWAG_TEST_DIST_DIR:'.next/uswag-baseline-test',USWAG_TEST_TSCONFIG:'.next/uswag-test-tsconfig.json'},stdio:['ignore','pipe','pipe'],detached:true});
 for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-12000);});
 const stop=()=>{try{process.kill(-server.pid,'SIGTERM');}catch{/* Already stopped. */}};
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){if(server.exitCode!==null){stop();throw new Error(`Isolated server exited: ${output}`);}try{if((await fetch(`${base}/api/auth/session`)).status===200)return {base,stop};}catch{/* Starting. */}await new Promise(resolve=>setTimeout(resolve,200));}
 stop();throw new Error(`Isolated server did not become ready: ${output}`);
}
async function login(base,email){const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:USWAG_TEST_PASSWORD})});assert.equal(response.status,200,await response.text());const cookie=response.headers.get('set-cookie');assert.ok(cookie);return cookie.split(';')[0];}

test('complete setup provides four logins, approved one-day event, QR continuity and reset restoration',async t=>{
 const db=await createDisposableDatabase('test_uswag_baseline');let server;
 try{
  const first=command(db,'uswag:setup');assert.equal(first.status,0,first.stderr);
  const before=await snapshot(db);assert.equal(before.users.length,4);assert.equal(before.students.length,94);assert.equal(before.groups.length,74);assert.equal(before.memberships.length,94);assert.equal(before.events.length,1);
  const event=before.events[0];assert.equal(event.title,'USWAG 2026');assert.equal(event.status,'APPROVED');assert.equal(event.allDay,true);assert.equal(event.isTimeout,false);assert.equal(event.location,null);
  assert.equal(new Date(event.start).toISOString(),'2026-10-25T16:00:00.000Z');assert.equal(new Date(event.end).toISOString(),'2026-10-26T16:00:00.000Z');assert.equal(new Date(event.end)-new Date(event.start),86400000);
  const admin=before.users.find(u=>u.email==='admin@uswag.test'),owner=before.users.find(u=>u.email==='organizer1@uswag.test');assert.equal(event.createdById,owner.id);assert.equal(event.reviewedById,admin.id);assert.ok(event.reviewedAt);
  assert.ok(before.users.every(u=>u.status==='ACTIVE'&&!u.mustChangePassword&&u.password.startsWith('scrypt:')));assert.equal(before.eventGroups.length,7);
  const eligible=await query(db,'SELECT DISTINCT s.id FROM "Student" s JOIN "CustomGroupMembership" m ON m."studentId"=s.id JOIN "_EventGroups" e ON e."B"=m."groupId" WHERE e."A"=$1',[event.id]);assert.equal(eligible.length,94);
  const repeated=command(db,'uswag:setup');assert.equal(repeated.status,0,repeated.stderr);assert.deepEqual(await snapshot(db),before);
  server=await startServer(db);
  const cookies=[];for(const user of USWAG_BASELINE_ACCOUNTS)cookies.push(await login(server.base,user.email));
  for(let i=1;i<=3;i++){
   const visible=await fetch(`${server.base}/api/events?scope=visible`,{headers:{Cookie:cookies[i]}});assert.equal(visible.status,200);const data=await visible.json();assert.ok(data.data.some(e=>e.id===event.id&&e.status==='APPROVED'));
   const response=await fetch(`${server.base}/api/records`,{method:'POST',headers:{Cookie:cookies[i],'Content-Type':'application/json'},body:JSON.stringify({eventId:event.id,studentId:before.students[i].usn,method:'SCANNED',expectedMode:'TIME_IN'})});assert.equal(response.status,201,await response.text());
  }
  const recorded=await snapshot(db);assert.equal(recorded.records.length,3);const replay=command(db,'uswag:setup');assert.equal(replay.status,0,replay.stderr);assert.deepEqual(await snapshot(db),recorded);
  const printed=new Set(before.students.map(s=>resolveQRIdentifier(s).value));
  const reset=command(db,'uswag:reset');assert.equal(reset.status,0,reset.stderr);assert.match(reset.stdout,/"outcome": "committed"/);
  const restored=await snapshot(db);assert.equal(restored.students.length,94);assert.equal(restored.groups.length,74);assert.equal(restored.users.length,4);assert.equal(restored.events.length,1);assert.equal(restored.events[0].status,'APPROVED');assert.equal(restored.records,null);assert.equal(restored.memberships.length,94);
  assert.deepEqual(new Set(restored.students.map(s=>resolveQRIdentifier(s).value)),printed);
  for(const user of USWAG_BASELINE_ACCOUNTS)await login(server.base,user.email);
  t.diagnostic(JSON.stringify({database:db.dbName,accounts:4,students:94,groups:74,memberships:94,approvedEvents:1,httpLogins:8,organizersRecorded:3,resetRestored:true}));
 }finally{server?.stop();await db.cleanup();}
});
test('event creation failure rolls back users, roster and group creation together',async()=>{
 const db=await createDisposableDatabase('test_uswag_baseline_rollback');try{
  await query(db,`CREATE FUNCTION fail_baseline_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic event failure'; END $$; CREATE TRIGGER fail_baseline_event BEFORE INSERT ON "Event" FOR EACH ROW EXECUTE FUNCTION fail_baseline_event()`);
  const result=command(db,'uswag:setup');assert.notEqual(result.status,0);assert.match(result.stderr,/APPLY_ROLLED_BACK/);
  const state=await snapshot(db);assert.equal(state.users,null);assert.equal(state.students,null);assert.equal(state.groups,null);assert.equal(state.events,null);
 }finally{await db.cleanup();}
});
