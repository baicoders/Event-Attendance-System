import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from './http.mjs';
import { reconcileEvidence, runLane, summarize, phaseTiming } from './core.mjs';
import { availablePort } from './fixture.mjs';
import { statusReadPaths, shouldPoll } from './traffic-policy.mjs';

const progressPath=id=>`/api/events/${id}/progress?groupBy=SECTION&includeRows=1&bucket=all&status=ALL&page=1&pageSize=50`;

export async function runScreen(fixture,screen,options,{onMetric,onOperation,onPhase,signal}) {
  const {db,students,accounts,password,base,ca}=fixture;
  const event=await fixture.newEvent(screen);
  const ids=students.slice(0,options.attendees).map(student=>student.id);
  const phases=[],background=new Set(),readErrors=[];
  let tag='setup';
  const lastReads=accounts.map(()=>new Map());
  const clients=accounts.map((_,lane)=>createClient({base,ca,onMetric:sample=>{
    if(sample.method==='GET')lastReads[lane].set(sample.path,performance.now());
    onMetric({...sample,lane,screen,phase:tag});
  }}));
  const track=promise=>{
    const handled=promise.catch(error=>readErrors.push({code:error.code,message:error.message,phase:tag})).finally(()=>background.delete(handled));
    background.add(handled);
    return handled;
  };
  const selected=new Map(),manualPanels=new Set();
  const eventRead=`/api/events/${event.id}`;
  const stats=`/api/events/${event.id}/stats`;
  const readStatus=(lane,writtenStudentId)=>{
    for(const path of statusReadPaths({screen,eventId:event.id,manualOpen:manualPanels.has(lane),selectedStudentId:selected.get(lane),writtenStudentId}))track(clients[lane].call(path));
  };
  const poll=()=>{
    const due=(lane,path)=>{
      if(shouldPoll(lastReads[lane].get(path),clients[lane].isPending(path),performance.now()))track(clients[lane].call(path));
    };
    for(let lane=0;lane<5;lane++)for(const path of [eventRead,...statusReadPaths({screen,eventId:event.id,manualOpen:manualPanels.has(lane),selectedStudentId:selected.get(lane)})])due(lane,path);
    due(5,progressPath(event.id));
  };
  let poller;
  try {
    for(let lane=0;lane<clients.length;lane++)await clients[lane].call('/api/auth/login',{method:'POST',body:{email:accounts[lane].email,password}});
    for(let lane=0;lane<5;lane++) {
      await clients[lane].call('/api/auth/session');
      await clients[lane].call('/api/events?status=APPROVED');
      if(screen==='regular')await clients[lane].call(`/api/students?eventId=${event.id}`);
    }
    poll();await Promise.all([...background]);
    // Query observers reset their polling clock after every completed refetch,
    // including a mutation's invalidation. Do not add fixed extra polls on top.
    poller=setInterval(poll,100);
    async function attempt(lane,index,operation,measured=true,lagMs=0,targetEvent=event) {
      const student=students[index];
      // One manual arrival per twenty, rotated across the five phones.
      const manual=index%20===Math.floor(index/20)%5;
      const started=performance.now();
      let failure=null;
      try {
        if(manual) {
          manualPanels.add(lane);
          await clients[lane].call(`/api/students?eventId=${targetEvent.id}`);
          if(screen==='operator')await clients[lane].call(`/api/events/${targetEvent.id}/records?includeWithoutTimeIn=true`);
          await clients[lane].call(`/api/records?eventId=${targetEvent.id}&studentId=${student.id}`);
          selected.set(lane,student.id);
        } else {
          const lookup=await clients[lane].call(`/api/students?${new URLSearchParams({eventId:targetEvent.id,studentId:student.usn ?? student.lrn ?? student.id})}`);
          assert.equal(lookup.id,student.id);
        }
        const result=await clients[lane].call('/api/records',{method:'POST',body:{eventId:targetEvent.id,studentId:student.id,method:manual?'MANUAL':'SCANNED',expectedMode:operation}});
        assert.equal(result.studentId,student.id);
        assert.equal(result.operation,operation);
        assert.equal(result.changed,true);
        assert.ok(result[operation==='TIME_IN'?'timein':'timeout']);
        if(targetEvent.id===event.id)readStatus(lane,student.id);
      } catch(error) {failure={code:error.code ?? 'ASSERTION',message:error.message};}
      finally {manualPanels.delete(lane);}
      const sample={screen,phase:tag,lane,studentId:student.id,operation,manual,ms:performance.now()-started,lagMs,failure};
      if(measured)onOperation(sample);
      return sample;
    }
    tag='warmup';
    const warm=await fixture.newEvent(`${screen} warmup`);
    const warmStart=performance.now();
    let warmIndex=0;
    while(performance.now()-warmStart<options.warmupSeconds*1000) {
      signal.throwIfAborted();
      const results=await Promise.all(Array.from({length:5},(_,lane)=>attempt(lane,warmIndex+lane,'TIME_IN',false,0,warm)));
      if(results.some(result=>result.failure))throw new Error('Warm-up request failed');
      warmIndex=(warmIndex+5)%options.roster;
      await delay(1000);
    }
    if(readErrors.length)throw new Error('Setup/warm-up background reads failed; inspect requests.csv');
    selected.clear();manualPanels.clear();
    // Warm-up has its own event, so measured check-in always begins empty.
    let firstTimes={};
    for(const operation of ['TIME_IN','TIME_OUT']) {
      signal.throwIfAborted();
      if(operation==='TIME_OUT') {
        await clients[0].call(`/api/events/${event.id}/timeout`,{method:'POST',body:{isTimeout:true}});
        // Model every device observing the new mode before the departure phase.
        await Promise.all(clients.slice(0,5).map(client=>client.call(eventRead)));
      }
      await Promise.all([...background]);
      tag=operation;
      const errorStart=readErrors.length;
      const samples=[];
      const duration=(operation==='TIME_IN'?options.checkinSeconds:options.checkoutSeconds)*1000;
      const intervalMs=duration*5/options.attendees;
      const start=performance.now();
      const wallStart=Date.now();
      console.log(`${screen}: ${operation}, ${options.attendees} arrivals over ${duration/1000}s`);
      const heartbeat=setInterval(()=>console.log(`${screen} ${operation}: ${samples.length}/${options.attendees} attempted, ${samples.filter(sample=>sample.failure).length} failed`),30000);
      let lanes;
      try {
        lanes=await Promise.all(Array.from({length:5},(_,lane)=>runLane({
          count:Math.ceil((options.attendees-lane)/5),intervalMs,offsetMs:lane*intervalMs/5,start,signal,
          operation:async(index,lag)=>{samples.push(await attempt(lane,index*5+lane,operation,true,lag));},
        })));
      } finally {clearInterval(heartbeat);}
      // Include the final offered slot, even when the last write finishes early.
      if(performance.now()<start+duration)await delay(start+duration-performance.now());
      await Promise.all([...background]);
      const timing=phaseTiming(performance.now()-start,Date.now()-wallStart);
      const elapsed=timing.durationMs;
      const records=await db.record.findMany({where:{eventId:event.id}});
      const changes=await db.attendanceChange.findMany({where:{eventId:event.id},select:{studentId:true,action:true}});
      if(operation==='TIME_IN')firstTimes=Object.fromEntries(records.filter(record=>record.timein).map(record=>[record.studentId,record.timein.toISOString()]));
      const admin=await clients[5].call(stats);
      const progress=await clients[5].call(progressPath(event.id));
      const eventReport=await clients[5].call(`/api/reports/events/${event.id}`);
      const evidenceErrors=reconcileEvidence({ids,records,changes,mode:operation,firstTimes,
        readers:{eligible:options.roster,stats:admin,progress,report:eventReport}});
      const phase={screen,operation,offered:options.attendees,completed:samples.filter(sample=>!sample.failure).length,
        ...timing,throughputPerMinute:samples.filter(sample=>!sample.failure).length/(elapsed/60000),
        unexpectedFailures:samples.filter(sample=>sample.failure).length+readErrors.length-errorStart,
        missedSlots:lanes.reduce((sum,lane)=>sum+lane.missedSlots,0),maxBacklog:Math.max(...lanes.map(lane=>lane.maxBacklog)),
        maxDelayMs:Math.max(...lanes.map(lane=>lane.maxDelayMs)),latency:summarize(samples.map(sample=>sample.ms)),
        earlyLatency:summarize(samples.slice().sort((a,b)=>a.studentId.localeCompare(b.studentId)).slice(0,Math.ceil(samples.length/4)).map(sample=>sample.ms)),
        lateLatency:summarize(samples.slice().sort((a,b)=>a.studentId.localeCompare(b.studentId)).slice(-Math.ceil(samples.length/4)).map(sample=>sample.ms)),
        evidenceErrors,recordCount:records.length,auditCount:changes.length,backgroundFailures:readErrors.slice(errorStart)};
      phases.push(phase);onPhase(phase);
    }
    tag='correctness';
    await correctnessChecks(fixture,clients,event,ids);
    return phases;
  } finally {
    clearInterval(poller);
    await Promise.all([...background]);
    clients.forEach(client=>client.close());
  }
}

async function correctnessChecks(fixture,clients,event,ids) {
  const {db}=fixture;
  const studentId=ids[0];
  const collision=await fixture.newEvent('fresh concurrent collision');
  const collisionResults=await Promise.all(clients.slice(0,5).map(client=>client.call('/api/records',{method:'POST',
    body:{eventId:collision.id,studentId,method:'SCANNED',expectedMode:'TIME_IN'}})));
  assert.equal(collisionResults.filter(result=>result.changed).length,1);
  assert.equal(new Set(collisionResults.map(result=>result.timein)).size,1);
  assert.equal(await db.record.count({where:{eventId:collision.id}}),1);
  assert.equal(await db.attendanceChange.count({where:{eventId:collision.id}}),1);
  const restricted=await fixture.newEvent('college eligibility');
  await db.event.update({where:{id:restricted.id},data:{category:'COLLEGE'}});
  await assert.rejects(clients[0].call(`/api/students?eventId=${restricted.id}&studentId=${studentId}`,{expected:true}),error=>error.status===404);
  await assert.rejects(clients[0].call('/api/records',{method:'POST',body:{eventId:restricted.id,studentId,method:'SCANNED',expectedMode:'TIME_IN'},expected:true}),error=>error.code==='STUDENT_UNAVAILABLE');
  assert.equal(await db.record.count({where:{eventId:restricted.id}}),0);
  assert.equal(await db.attendanceChange.count({where:{eventId:restricted.id}}),0);
  const before=await db.record.findUniqueOrThrow({where:{eventId_studentId:{eventId:event.id,studentId}}});
  const auditCountBefore=await db.attendanceChange.count({where:{eventId:event.id}});
  const body={eventId:event.id,studentId,method:'SCANNED',expectedMode:'TIME_OUT'};
  const duplicates=await Promise.all(clients.slice(0,5).map(client=>client.call('/api/records',{method:'POST',body})));
  assert.ok(duplicates.every(result=>!result.changed && result.timeout===before.timeout.toISOString()));
  assert.equal(await db.attendanceChange.count({where:{eventId:event.id}}),auditCountBefore);
  await assert.rejects(clients[0].call('/api/records',{method:'POST',body:{...body,expectedMode:'TIME_IN'},expected:true}),error=>error.code==='EVENT_MODE_CHANGED');
  await assert.rejects(clients[0].call(`/api/students?eventId=${event.id}&studentId=99999999999`,{expected:true}),error=>error.status===404);
  const timeoutOnly=await fixture.newEvent('timeout-only');
  await clients[0].call(`/api/events/${timeoutOnly.id}/timeout`,{method:'POST',body:{isTimeout:true}});
  const out=await clients[0].call('/api/records',{method:'POST',body:{...body,eventId:timeoutOnly.id}});
  assert.equal(out.timein,null);assert.ok(out.timeout);
  const uncertain=await fixture.newEvent('lost-response');
  let unknownWrites=0;
  await assert.rejects((async()=>{
    unknownWrites++;
    return clients[0].call('/api/records',{method:'POST',body:{...body,eventId:uncertain.id,expectedMode:'TIME_IN'},discardResponse:true,expected:true});
  })(),error=>error.code==='RESULT_UNKNOWN');
  assert.equal(unknownWrites,1);
  const stored=await clients[0].call(`/api/records?eventId=${uncertain.id}&studentId=${studentId}`);
  assert.ok(stored.timein);
  assert.equal(await db.record.count({where:{eventId:uncertain.id}}),1);
  assert.equal(await db.attendanceChange.count({where:{eventId:uncertain.id}}),1);
  const beforeSend=await fixture.newEvent('failed-before-send');
  const offline=createClient({base:`https://127.0.0.1:${await availablePort()}`});
  try {
    await assert.rejects((async()=>{
      await offline.call(`/api/students?eventId=${beforeSend.id}&studentId=${studentId}`);
      // A failed lookup must never reach this write.
      await offline.call('/api/records',{method:'POST',body:{...body,eventId:beforeSend.id,expectedMode:'TIME_IN'}});
    })(),error=>error.code==='READ_FAILED');
    assert.equal(await db.record.count({where:{eventId:beforeSend.id}}),0);
    assert.equal(await db.attendanceChange.count({where:{eventId:beforeSend.id}}),0);
  } finally {offline.close();}
  const after=await db.record.findUniqueOrThrow({where:{id:before.id}});
  assert.equal(after.timein.toISOString(),before.timein.toISOString());
  assert.equal(after.timeout.toISOString(),before.timeout.toISOString());
  assert.equal(after.revision,2);
}
