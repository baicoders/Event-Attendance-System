import { setTimeout as delay } from 'node:timers/promises';

export function parseOptions(args) {
  const options = { roster:3000, attendees:3000, checkinSeconds:1800, checkoutSeconds:600,
    warmupSeconds:60, screen:'both', label:'run', phones:false, quick:false, baseUrl:null, skipBuild:false };
  const values = { '--attendees':'attendees', '--checkin-seconds':'checkinSeconds', '--checkout-seconds':'checkoutSeconds',
    '--warmup-seconds':'warmupSeconds', '--screen':'screen', '--label':'label', '--base-url':'baseUrl' };
  for (let i=0;i<args.length;i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--quick') { options.quick=true; continue; }
    if (arg === '--phones') { options.phones=true; continue; }
    if (arg === '--skip-build') { options.skipBuild=true; continue; }
    if (!values[arg] || !args[i+1] || args[i+1].startsWith('--')) throw new Error(`Unknown option or missing value: ${arg}`);
    options[values[arg]]=args[++i];
  }
  if (options.quick) {
    for (const [flag,key,value] of [['--attendees','attendees',100],['--checkin-seconds','checkinSeconds',60],['--checkout-seconds','checkoutSeconds',20],['--warmup-seconds','warmupSeconds',5]]) {
      if (!args.includes(flag)) options[key]=value;
    }
  }
  for (const key of ['attendees','checkinSeconds','checkoutSeconds','warmupSeconds']) {
    options[key]=Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key]<1) throw new Error(`Invalid ${key}: use a positive integer`);
  }
  if (options.attendees>options.roster || options.attendees<5) throw new Error('attendees must be between 5 and 3000');
  if (!['operator','regular','both'].includes(options.screen)) throw new Error('screen must be operator, regular, or both');
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(options.label)) throw new Error('label must use letters, numbers, underscores, or hyphens');
  if (options.baseUrl) {
    const url=new URL(options.baseUrl);
    if (url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('base-url must be an HTTPS origin');
    options.baseUrl=url.origin;
    if (!options.phones) throw new Error('base-url is only accepted for the runner-owned phone rehearsal');
  }
  return options;
}

/** Fixed offered arrivals. Slow lanes drain their backlog, with no overlapping attendance writes. */
export async function runLane({ count, intervalMs, offsetMs, start, operation, now=performance.now.bind(performance), sleep=delay, signal }) {
  let missedSlots=0, maxDelayMs=0, maxBacklog=0;
  for (let index=0;index<count;index++) {
    signal?.throwIfAborted();
    const due=start+offsetMs+index*intervalMs;
    if (now()<due) await sleep(due-now());
    signal?.throwIfAborted();
    const late=Math.max(0,now()-due);
    if (late>=intervalMs) missedSlots++;
    maxDelayMs=Math.max(maxDelayMs,late);
    await operation(index, late);
    // Count offered arrivals still waiting after this operation, including any
    // that arrived while it ran. Slot lateness alone overcounts after arrivals end.
    const arrived=Math.min(count,Math.floor((now()-start-offsetMs)/intervalMs)+1);
    maxBacklog=Math.max(maxBacklog,Math.max(0,arrived-index-1));
  }
  return { missedSlots, maxDelayMs, maxBacklog };
}

export function summarize(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  const p=fraction=>sorted.length ? Math.round(sorted[Math.ceil(sorted.length*fraction)-1]*100)/100 : null;
  return { count:sorted.length, p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:p(1) };
}

export function phaseTiming(monotonicElapsedMs,wallElapsedMs) {
  const clockDeltaMs=wallElapsedMs-monotonicElapsedMs;
  return {durationMs:Math.max(monotonicElapsedMs,wallElapsedMs),clockDeltaMs,
    infrastructureErrors:Math.abs(clockDeltaMs)>5000?['Host paused or its clock changed during the phase; repeat on an awake host.']:[]};
}

export function reconcileEvidence({ ids, records, changes, mode, firstTimes={}, readers }) {
  const errors=[];
  const byId=new Map(records.map(record=>[record.studentId,record]));
  if (records.length!==ids.length || byId.size!==records.length) errors.push(`Record count ${records.length}, expected ${ids.length}`);
  for (const id of ids) {
    const record=byId.get(id);
    if (!record) { errors.push(`Missing record: ${id}`); continue; }
    if (!record.timein || (mode==='TIME_OUT' && !record.timeout)) errors.push(`Missing timestamp: ${id}`);
    if (firstTimes[id] && new Date(record.timein).toISOString()!==firstTimes[id]) errors.push(`First timestamp changed: ${id}`);
    const audit=changes.filter(change=>change.studentId===id);
    if (audit.filter(change=>change.action==='CREATE').length!==1 ||
      audit.filter(change=>change.action==='TIME_OUT').length!==(mode==='TIME_OUT'?1:0) ||
      audit.length!==(mode==='TIME_OUT'?2:1) || record.revision!==(mode==='TIME_OUT'?2:1)) errors.push(`Audit/revision mismatch: ${id}`);
  }
  if(readers) {
    const present=records.filter(record=>record.timein).length;
    if(readers.stats.eligible!==readers.eligible || readers.stats.present!==present ||
      readers.progress.totals?.checkedIn!==present || readers.report.totals?.attended!==present) {
      errors.push(`Public totals mismatch: database=${present}, stats=${JSON.stringify(readers.stats)}, progress=${JSON.stringify(readers.progress.totals)}, report=${JSON.stringify(readers.report.totals)}`);
    }
  }
  return errors;
}

export function verdict(phases, complete) {
  const reasons=[];
  if (!complete || !phases.length) reasons.push('Run incomplete');
  for (const phase of phases) {
    if(phase.infrastructureErrors?.length)reasons.push(`${phase.screen ?? ''} ${phase.operation}: host timing interruption`);
    if (phase.completed!==phase.offered || phase.unexpectedFailures || phase.evidenceErrors.length) reasons.push(`${phase.screen ?? ''} ${phase.operation}: request or correctness failure`);
    if (phase.operation==='TIME_IN' && (phase.missedSlots || phase.latency.p95Ms===null || phase.latency.p95Ms>1000 || phase.latency.p99Ms>2000 || phase.completed/(phase.durationMs/60000)<99.5)) reasons.push(`${phase.screen ?? ''} TIME_IN: capacity target missed`);
  }
  return { passed:reasons.length===0, reasons };
}
