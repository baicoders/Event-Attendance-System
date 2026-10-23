/** Regression for generated canonical IDs across roster maintenance and event searches.
 * All records live in a migrated disposable test database. Run after build. */
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {Pool} from 'pg';
import {createDisposableDatabase} from './pg-test-db.mjs';
const fixture=await createDisposableDatabase('test_identifier_surroundings');
const pool=new Pool({connectionString:fixture.url});
const db=new PrismaClient({adapter:new PrismaPg(pool)});
const secret='synthetic-identifier-regression-secret';
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const base=`http://127.0.0.1:${port}`;
let server;
try {
 const actor=await db.user.create({data:{name:'Synthetic Admin',email:'identifier-regression@example.test',password:'fixture',role:'ADMIN',status:'ACTIVE'}});
 const session={id:actor.id,name:actor.name,email:actor.email,role:actor.role,status:actor.status,credentialVersion:0,mustChangePassword:false};
 const encoded=Buffer.from(JSON.stringify({session,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 const cookie=`event-attendance-auth=${encoded}.${createHmac('sha256',secret).update(encoded).digest('base64url')}`;
 server=spawn('pnpm',['start','-p',String(port)],{env:{...process.env,DATABASE_URL:fixture.url,DIRECT_URL:fixture.url,AUTH_SECRET:secret,NODE_ENV:'production'},stdio:'ignore',detached:true});
 let ready=false;
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(`Fixture server exited ${server.exitCode}`);try{if((await fetch(`${base}/api/auth/session`)).status<500){ready=true;break;}}catch{}await delay(250);}
 assert.ok(ready,'isolated server ready');
 const api=async(path,body)=>{
  const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(result)}`);assert.equal(result.success,true);return result.data;
 };
 const house=await db.group.create({data:{name:'Synthetic House',slug:'synthetic-house',category:'HOUSE'}});
 const person=await api('/api/students',{usn:'00000123456',lrn:'000000123456',firstName:'Synthetic',lastName:'Student'});
 assert.equal(person.id.length,25);assert.notEqual(person.id,person.usn);
 const preview=await api('/api/students/bulk/preview',{studentIds:[person.id],action:'SET_HOUSE',targetGroupId:house.id});
 assert.equal(preview.changedCount,1);assert.ok(preview.previewToken);
 const committed=await api('/api/students/bulk/commit',{previewToken:preview.previewToken,acknowledgeReportImpact:true});
 assert.deepEqual(committed.changedIds,[person.id]);
 const exported=await api('/api/students/export-selected',{studentIds:[person.id]});
 assert.equal(exported.schemaVersion,2);assert.equal(exported.rows[0].studentId,person.id);assert.equal(exported.rows[0].usn,person.usn);assert.equal(exported.rows[0].lrn,person.lrn);
 const event=await db.event.create({data:{title:'Synthetic Event',category:'ALL',status:'APPROVED',createdById:actor.id,start:new Date(Date.now()-60000),end:new Date(Date.now()+3600000)}});
 await api('/api/records',{eventId:event.id,studentId:person.lrn,method:'MANUAL',expectedMode:'TIME_IN'});
 for(const search of [person.usn,person.lrn,'123456']) {
  const audience=await api('/api/events/audience-preview',{category:'ALL',includedGroups:[],search,includeRoster:true});
  assert.equal(audience.searchMatches,1);assert.equal(audience.students[0].id,person.id);
  const progress=await api(`/api/events/${event.id}/progress?${new URLSearchParams({includeRows:'1',status:'ALL',q:search})}`);
  assert.equal(progress.detail.matchedCount,1);assert.equal(progress.detail.rows[0].studentId,person.id);
  const review=await api(`/api/events/${event.id}/attendance-review?${new URLSearchParams({search})}`);
  assert.equal(review.total,1);assert.equal(review.items[0].studentId,person.id);
 }
 const missingYear=await api(`/api/events/${event.id}/progress?groupBy=YEAR&includeRows=1&bucket=none&status=ALL`);
 assert.equal(missingYear.detail.rows[0].studentId,person.id);
 assert.equal(await db.record.count({where:{studentId:person.id}}),1);
 console.log('Identifier surroundings API passed: generated-ID bulk preview/commit, separate USN/LRN export, audience/progress/review searches, missing-year bucket and canonical attendance.');
} finally {
 if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{}}
 await db.$disconnect();await pool.end();await fixture.cleanup();
}
