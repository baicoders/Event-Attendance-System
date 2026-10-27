import { readFileSync } from 'node:fs';
import { freemem, totalmem, loadavg, cpus } from 'node:os';

/** Linux host counters plus runner-owned process RSS; unavailable counters remain null. */
export function sampleResources(pids) {
  const sample={at:new Date().toISOString(),host:{totalBytes:totalmem(),freeBytes:freemem(),load:loadavg()},
    generator:{pid:process.pid,rssBytes:process.memoryUsage().rss,cpuMicroseconds:process.cpuUsage()},processes:{}};
  try {
    const memory=readFileSync('/proc/meminfo','utf8');
    sample.host.availableBytes=Number(memory.match(/^MemAvailable:\s+(\d+)/m)[1])*1024;
    sample.host.swapUsedBytes=(Number(memory.match(/^SwapTotal:\s+(\d+)/m)[1])-Number(memory.match(/^SwapFree:\s+(\d+)/m)[1]))*1024;
  } catch { sample.host.availableBytes=null;sample.host.swapUsedBytes=null; }
  const times=cpus().map(cpu=>cpu.times);
  sample.host.cpuTicks={idle:times.reduce((sum,time)=>sum+time.idle,0),total:times.reduce((sum,time)=>sum+Object.values(time).reduce((a,b)=>a+b,0),0)};
  for(const [name,pid] of Object.entries(pids)) {
    try {
      const status=readFileSync(`/proc/${pid}/status`,'utf8');
      sample.processes[name]={pid,rssBytes:Number(status.match(/^VmRSS:\s+(\d+)/m)[1])*1024};
    } catch {sample.processes[name]=null;}
  }
  return sample;
}

export function summarizeResources(samples) {
  const finite=values=>values.filter(value=>typeof value==='number' && Number.isFinite(value));
  const max=values=>{const valid=finite(values);return valid.length?Math.max(...valid):null;};
  const min=values=>{const valid=finite(values);return valid.length?Math.min(...valid):null;};
  const busy=[];
  let busyTicks=0,totalTicks=0;
  for(let index=1;index<samples.length;index++) {
    const previous=samples[index-1].host.cpuTicks,current=samples[index].host.cpuTicks;
    const total=current.total-previous.total,idle=current.idle-previous.idle;
    if(total>0 && idle>=0) {busy.push((total-idle)/total*100);busyTicks+=total-idle;totalTicks+=total;}
  }
  return {averageHostBusyPercent:totalTicks?Math.round(busyTicks/totalTicks*10000)/100:null,maxHostBusyPercent:max(busy),
    minAvailableBytes:min(samples.map(sample=>sample.host.availableBytes)),maxSwapUsedBytes:max(samples.map(sample=>sample.host.swapUsedBytes)),
    peakGeneratorRssBytes:max(samples.map(sample=>sample.generator.rssBytes)),
    peakAppRssBytes:max(samples.map(sample=>sample.processes.app?.rssBytes)),peakCaddyRssBytes:max(samples.map(sample=>sample.processes.caddy?.rssBytes))};
}
