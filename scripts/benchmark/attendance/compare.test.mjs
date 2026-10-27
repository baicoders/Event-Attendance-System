import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareReports } from './compare.mjs';

test('comparison refuses incomplete or differently paced runs and retains failed capacity results',()=>{
  const phase={screen:'operator',operation:'TIME_IN',completed:3000,offered:3000,latency:{p95Ms:500,p99Ms:900},missedSlots:0,unexpectedFailures:0};
  const baseline={completed:true,harnessHash:'same-workload',options:{label:'baseline',attendees:3000,checkinSeconds:1800,checkoutSeconds:600,warmupSeconds:60,screen:'both'},phases:[phase],verdict:{passed:false}};
  const improved={...baseline,options:{...baseline.options,label:'improved'},phases:[{...phase,latency:{p95Ms:400,p99Ms:600}}],verdict:{passed:true}};
  assert.match(compareReports(baseline,improved),/500.*400/);
  assert.match(compareReports(baseline,improved),/false.*true/);
  assert.throws(()=>compareReports(baseline,{...improved,completed:false}),/incomplete/i);
  assert.throws(()=>compareReports(baseline,{...improved,options:{...improved.options,checkinSeconds:60}}),/profile/i);
  assert.throws(()=>compareReports(baseline,{...improved,phases:[]}),/phase/i);
  assert.throws(()=>compareReports(baseline,{...improved,harnessHash:'changed-workload'}),/harness/i);
  assert.throws(()=>compareReports(baseline,{...improved,phases:[{...phase,infrastructureErrors:['Host paused']}]}),/host timing/i);
});
