import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function compareReports(baseline,improved) {
  if(!baseline.completed || !improved.completed)throw new Error('Cannot compare incomplete runs');
  if([...baseline.phases,...improved.phases].some(phase=>phase.infrastructureErrors?.length))throw new Error('Host timing interruption: repeat the affected run before comparing');
  if(!baseline.harnessHash || baseline.harnessHash!==improved.harnessHash)throw new Error('Harness mismatch: compare reports produced with the same fixture and request model');
  for(const key of ['roster','attendees','checkinSeconds','checkoutSeconds','warmupSeconds','screen']) {
    if(baseline.options[key]!==improved.options[key])throw new Error(`Profile mismatch: ${key}`);
  }
  const key=phase=>`${phase.screen} ${phase.operation}`;
  if(!baseline.phases.length || baseline.phases.length!==improved.phases.length ||
    new Set(baseline.phases.map(key)).size!==baseline.phases.length ||
    baseline.phases.some(phase=>!improved.phases.some(other=>key(other)===key(phase))))throw new Error('Phase mismatch');
  const lines=['# Attendance benchmark comparison','',
    `Check-in profile: ${baseline.options.attendees} attendees / ${baseline.options.checkinSeconds}s, five operators.`,
    '', '| Screen / phase | Baseline p95 ms | Improved p95 ms | Baseline p99 ms | Improved p99 ms |',
    '| --- | ---: | ---: | ---: | ---: |'];
  for(const phase of baseline.phases) {
    const other=improved.phases.find(value=>key(value)===key(phase));
    lines.push(`| ${key(phase)} | ${phase.latency.p95Ms} | ${other.latency.p95Ms} | ${phase.latency.p99Ms} | ${other.latency.p99Ms} |`);
  }
  lines.push('',`| Profile verdict | ${baseline.verdict?.passed} | ${improved.verdict?.passed} |`,
    `| Full-duration capacity established | ${baseline.capacityEstablished ?? false} | ${improved.capacityEstablished ?? false} |`,
    '',`Baseline source: ${baseline.build?.sourceHash ?? 'unknown'}.`,
    `Improved source: ${improved.build?.sourceHash ?? 'unknown'}.`,
    '', 'Use each report for failure, backlog, correctness, endpoint bytes, and host-resource evidence. A quick profile does not establish full-event capacity; physical phones still require a separate rehearsal.');
  return lines.join('\n')+'\n';
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==4)throw new Error('Usage: pnpm benchmark:attendance:compare <baseline/report.json> <improved/report.json>');
    console.log(compareReports(...process.argv.slice(2).map(path=>JSON.parse(readFileSync(path,'utf8')))));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
