import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions, runLane, summarize, reconcileEvidence, verdict, phaseTiming } from './core.mjs';

test('full and quick profiles keep a 3000-student roster and reject unsafe or ambiguous input', () => {
  assert.equal(parseOptions([]).attendees, 3000);
  assert.equal(parseOptions([]).checkinSeconds, 1800);
  assert.equal(parseOptions(['--quick']).attendees, 100);
  assert.equal(parseOptions(['--quick']).roster, 3000);
  for (const args of [['--attendees','0'], ['--screen','invalid'], ['--label','../outside'], ['--unknown'], ['--checkin-seconds','NaN'], ['--base-url','http://localhost']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('a slow lane retains offered arrivals and exposes backlog rather than silently reducing load', async () => {
  let clock = 0;
  const starts = [];
  const result = await runLane({ count: 4, intervalMs: 1000, offsetMs: 0, start: 0,
    now: () => clock, sleep: async ms => { clock += ms; },
    operation: async index => { starts.push(index); clock += 2200; },
  });
  assert.deepEqual(starts, [0,1,2,3]);
  assert.equal(result.missedSlots, 3);
  assert.equal(result.maxBacklog, 2);
  assert.equal(result.maxDelayMs, 3600);
});

test('percentiles include failed operations instead of making a slow failing run look fast', () => {
  assert.deepEqual(summarize([10,20,30,1000]), { count:4, p50Ms:20, p95Ms:1000, p99Ms:1000, maxMs:1000 });
  assert.equal(summarize([]).p95Ms, null);
});

test('backlog counts only offered arrivals waiting during work, even after the arrival window closes',async()=>{
  for(const [workMs,expected] of [[10000,2],[50,0]]) {
    let clock=0;
    const result=await runLane({count:3,intervalMs:1000,offsetMs:500,start:0,
      now:()=>clock,sleep:async ms=>{clock+=ms;},operation:async()=>{clock+=workMs;}});
    assert.equal(result.maxBacklog,expected);
    if(workMs===10000) {
      assert.equal(result.missedSlots,2);
      assert.equal(result.maxDelayMs,18000);
    }
  }
});

test('reconciliation detects missing records, audit gaps, and changed first timestamps', () => {
  const records = [{studentId:'a',timein:'2026-01-01T00:00:00.000Z',timeout:'2026-01-01T01:00:00.000Z',revision:2}];
  const changes = [{studentId:'a',action:'CREATE'},{studentId:'a',action:'TIME_OUT'}];
  assert.deepEqual(reconcileEvidence({ ids:['a'], records, changes, mode:'TIME_OUT', firstTimes:{a:'2026-01-01T00:00:00.000Z'} }), []);
  assert.match(reconcileEvidence({ids:['a','b'],records,changes:[],mode:'TIME_OUT',firstTimes:{a:'different'}}).join(';'), /audit|timestamp|missing/i);
});

test('incomplete runs and injected failures cannot produce a passing capacity verdict', () => {
  const phase = { operation:'TIME_IN', completed:100, offered:100, durationMs:60000, missedSlots:0,
    unexpectedFailures:0, latency:{p95Ms:500,p99Ms:800}, evidenceErrors:[] };
  assert.equal(verdict([phase], true).passed, true);
  assert.equal(verdict([phase], false).passed, false);
  assert.equal(verdict([{...phase,completed:99}], true).passed, false);
  assert.equal(verdict([{...phase,unexpectedFailures:1}], true).passed, false);
  assert.equal(verdict([{...phase,missedSlots:1}], true).passed, false);
});

test('public totals compare all attended students, including late arrivals, against recorded time-ins',()=>{
  const evidence={ids:['a'],records:[{studentId:'a',timein:'2026-01-01T01:00:00.000Z',revision:1}],changes:[{studentId:'a',action:'CREATE'}],mode:'TIME_IN',
    readers:{eligible:3000,stats:{eligible:3000,present:1},progress:{totals:{checkedIn:1}},report:{totals:{present:0,late:1,attended:1}}}};
  assert.deepEqual(reconcileEvidence(evidence),[]);
  assert.match(reconcileEvidence({...evidence,readers:{...evidence.readers,report:{totals:{present:0,late:0,attended:0}}}}).join(';'),/totals mismatch/i);
});

test('suspend gaps count against real elapsed time and invalidate a capacity result',()=>{
  const timing=phaseTiming(60000,1860000);
  assert.equal(timing.durationMs,1860000);
  assert.equal(timing.clockDeltaMs,1800000);
  assert.equal(timing.infrastructureErrors.length,1);
  assert.equal(phaseTiming(60000,60002).infrastructureErrors.length,0);
  const phase={operation:'TIME_IN',completed:100,offered:100,missedSlots:0,unexpectedFailures:0,
    latency:{p95Ms:100,p99Ms:200},evidenceErrors:[],...timing};
  assert.equal(verdict([phase],true).passed,false);
  assert.equal(verdict([{...phase,...phaseTiming(60000,30000)}],true).passed,false);
});
