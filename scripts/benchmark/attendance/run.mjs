import 'dotenv/config';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseOptions, summarize, verdict } from './core.mjs';
import { startFixture } from './fixture.mjs';
import { runScreen } from './workload.mjs';
import { sampleResources, summarizeResources } from './resources.mjs';
import { harnessIdentity } from './identity.mjs';

if(process.argv.includes('--help')) {
  console.log(`Attendance rehearsal (all data disposable)
  pnpm benchmark:attendance -- --label baseline
  pnpm benchmark:attendance -- --quick --label smoke
  pnpm benchmark:attendance -- --phones --base-url https://<laptop-IP>

Options: --screen operator|regular|both, --label <name>, --quick, --phones,
  --attendees 5..3000, --checkin-seconds <n>, --checkout-seconds <n>,
  --warmup-seconds <n>, --skip-build (requires identical source), --base-url <HTTPS origin>.
Default: 3000-student roster, five operators, 30-minute check-in, 10-minute departure,
  60-second warm-up PER SCREEN; both screens take about 82 minutes plus build.
Requires explicit local TEST_DATABASE_URL. Never targets DATABASE_URL.
Phone mode requires the normal app's port 3000 to be free and Caddy already running.
Set ATTENDANCE_CADDY_CA to the existing Caddy root.crt for phone-mode Node verification.
See docs/testing/attendance-stress-test.md.`);
  process.exit(0);
}

let options;
try {options=parseOptions(process.argv.slice(2));}catch(error){console.error(error.message);process.exit(1);}
const id=`${options.label}-${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`;
const artifacts=resolve('test-results','attendance-load',id);
mkdirSync(artifacts,{recursive:true});
const path=join(artifacts,'report.json');
const report={schemaVersion:1,harnessHash:harnessIdentity(),startedAt:new Date().toISOString(),options,artifacts,completed:false,phases:[],
  sleepInhibited:process.env.ATTENDANCE_SLEEP_INHIBITED==='1',
  physicalChecks:'Not performed by automation',limitations:[
    'Sustained load is generated on this laptop and includes generator overhead.',
    'Loopback Caddy load does not measure phone camera decoding, Wi-Fi contention, or certificate installation.',
    'Physical phones and router must be rehearsed separately.',
  ]};
const persist=()=>writeFileSync(path,JSON.stringify(report,null,2));
persist();
const requests=createWriteStream(join(artifacts,'requests.csv'));
const operations=createWriteStream(join(artifacts,'operations.csv'));
const resources=createWriteStream(join(artifacts,'resources.jsonl'));
requests.write('at,screen,phase,lane,method,path,status,ms,bytes,outcome,expected\n');
operations.write('screen,phase,lane,studentId,operation,manual,ms,lagMs,failure\n');
const csv=values=>values.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')+'\n';
const endpoints=new Map();
const resourceSamples=[];
const controller=new AbortController();
let fixture,resourceTimer;
const interrupt=signal=>controller.abort(new Error(`Interrupted by ${signal}`));
const sigint=()=>interrupt('SIGINT'),sigterm=()=>interrupt('SIGTERM');
process.on('SIGINT',sigint);process.on('SIGTERM',sigterm);
console.log(`Rehearsal artifacts: ${artifacts}`);
try {
  fixture=await startFixture(options,artifacts);
  controller.signal.throwIfAborted();
  report.build=fixture.identity;
  report.buildId=fixture.buildId;
  report.processes={app:fixture.appPid,caddy:fixture.caddyPid};
  const sample=()=>{const value=sampleResources(report.processes);resourceSamples.push(value);resources.write(JSON.stringify(value)+'\n');};
  sample();resourceTimer=setInterval(sample,5000);
  if(options.phones) {
    const emptyEvent=await fixture.newEvent('physical phones - empty');
    const event=await fixture.newEvent('physical phones - near full');
    const {seedPhoneAttendance}=await import('./phone-fixture.mjs');
    const seeded=await seedPhoneAttendance(fixture.db,event,fixture.accounts[0],fixture.students);
    if(await fixture.db.record.count({where:{eventId:event.id}})!==seeded || await fixture.db.attendanceChange.count({where:{eventId:event.id}})!==seeded)throw new Error('Near-full phone fixture did not reconcile');
    controller.signal.throwIfAborted();
    fixture.writePhoneCards();
    const accounts=fixture.accounts.map(({email,role})=>({email,role,password:fixture.password}));
    writeFileSync(join(artifacts,'phone-credentials.json'),JSON.stringify({base:fixture.base,accounts,eventId:event.id,emptyEventId:emptyEvent.id,seeded},null,2),{mode:0o600});
    report.phoneEventId=event.id;
    report.phoneEmptyEventId=emptyEvent.id;report.phonePreloadedRecords=seeded;
    console.log(`\nPHONE REHEARSAL — synthetic database only\nNEAR-FULL EVENT (${seeded} synthetic check-ins; 100 printed cards remain unrecorded)\n${fixture.base}/attendance/operator?eventId=${event.id}\n${fixture.base}/attendance?eventId=${event.id}\n${fixture.base}/attendance/progress?eventId=${event.id}\nEMPTY EVENT (basic workflow checks)\n${fixture.base}/attendance/operator?eventId=${emptyEvent.id}\n${fixture.base}/attendance?eventId=${emptyEvent.id}\nAccounts: phone1@rehearsal.example.test through phone5@rehearsal.example.test\nAdmin: admin@rehearsal.example.test\nSynthetic password: ${fixture.password}\nQR cards: ${join(artifacts,'qr-cards.html')}\nKeep this terminal open. Ctrl+C captures evidence and cleans up the rehearsal.`);
    if(!controller.signal.aborted)await new Promise(ok=>controller.signal.addEventListener('abort',ok,{once:true}));
    const evidence=[];
    for(const target of [event,emptyEvent]) {
      const records=await fixture.db.record.findMany({where:{eventId:target.id}});
      const changes=await fixture.db.attendanceChange.findMany({where:{eventId:target.id}});
      evidence.push({eventId:target.id,title:target.title,preloadedRecords:target.id===event.id?seeded:0,records,changes});
    }
    writeFileSync(join(artifacts,'phone-evidence.json'),JSON.stringify({events:evidence},(_key,value)=>typeof value==='bigint'?String(value):value,2));
    report.phoneRecords=evidence.map(item=>({eventId:item.eventId,records:item.records.length,preloaded:item.preloadedRecords}));
    report.completed=true;
    report.verdict={passed:null,reasons:['Manual rehearsal evidence captured; physical checks require operator review']};
  } else {
    console.log('Checking real browser QR/manual request parity for both screens…');
    await fixture.browserParity();
    report.browserParity='passed';persist();
    const screens=options.screen==='both'?['operator','regular']:[options.screen];
    for(const screen of screens)await runScreen(fixture,screen,options,{
      signal:controller.signal,
      onMetric:metric=>{
        requests.write(csv([metric.at,metric.screen,metric.phase,metric.lane,metric.method,metric.path,metric.status,metric.ms.toFixed(2),metric.bytes,metric.outcome,metric.expected]));
        const endpoint=metric.path.replace(/\/events\/[^/?]+/,'/events/:eventId').replace(/studentId=[^&]+/,'studentId=:studentId');
        const key=`${metric.screen} ${metric.phase} ${metric.method} ${endpoint}`;
        if(!endpoints.has(key))endpoints.set(key,{key,ms:[],bytes:0,failures:0,expectedFailures:0});
        const bucket=endpoints.get(key);bucket.ms.push(metric.ms);bucket.bytes+=metric.bytes;
        if(metric.outcome!=='OK') {if(metric.expected)bucket.expectedFailures++;else bucket.failures++;}
      },
      onOperation:operation=>operations.write(csv([operation.screen,operation.phase,operation.lane,operation.studentId,operation.operation,operation.manual,operation.ms.toFixed(2),operation.lagMs.toFixed(2),operation.failure?.code])),
      onPhase:phase=>{
        report.phases.push(phase);persist();
        console.log(`${phase.screen} ${phase.operation}: ${phase.completed}/${phase.offered}, p95 ${phase.latency.p95Ms}ms, p99 ${phase.latency.p99Ms}ms, missed slots ${phase.missedSlots}, evidence errors ${phase.evidenceErrors.length}`);
      },
    });
    report.completed=true;
    report.verdict=verdict(report.phases,true);
    report.capacityEstablished=report.verdict.passed && options.attendees===options.roster && options.checkinSeconds===1800 && options.checkoutSeconds===600;
    if(options.attendees<options.roster)report.limitations.push(`Only ${options.attendees} of ${options.roster} eligible students traversed each phase; this is not a full-event capacity result.`);
    if(!report.verdict.passed)process.exitCode=1;
  }
} catch(error) {
  report.error=error.message;
  if(error.cleanupFailed)report.cleanupError=error.message;
  report.verdict=verdict(report.phases,false);
  console.error(error.stack ?? error.message);process.exitCode=1;
} finally {
  clearInterval(resourceTimer);
  try {await fixture?.cleanup();report.cleanedUp=!report.cleanupError;} catch(error){report.cleanupError=error.message;report.cleanedUp=false;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();
  report.resources=summarizeResources(resourceSamples);
  report.endpoints=[...endpoints.values()].map(({ms,...bucket})=>({...bucket,latency:summarize(ms)}));
  persist();
  for(const stream of [requests,operations,resources])await new Promise(ok=>stream.end(ok));
  process.off('SIGINT',sigint);process.off('SIGTERM',sigterm);
  console.log(`Report: ${path}`);
}
