import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const cli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
test('sleep wrapper forwards arguments and does not rerun a failed benchmark',()=>{
  const dir=mkdtempSync(join(tmpdir(),'attendance-launcher-'));
  try {
    const log=join(dir,'calls');
    writeFileSync(join(dir,'systemd-inhibit'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in --*) shift;; *) break;; esac; done\nprintf "%s\\n" "$1" >> "$ATTENDANCE_TEST_CALLS"\nexec "$@"\n',{mode:0o755});
    const env={...process.env,PATH:dir+':/usr/bin:/bin',ATTENDANCE_TEST_CALLS:log};
    delete env.ATTENDANCE_SLEEP_INHIBITED;
    const result=spawnSync(process.execPath,[cli,'--label','../unsafe'],{env,encoding:'utf8',timeout:30000});
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/label must/);
    assert.equal(readFileSync(log,'utf8').split('\n').filter(line=>line===process.execPath).length,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('help remains usable when a sleep inhibitor is unavailable',()=>{
  const dir=mkdtempSync(join(tmpdir(),'attendance-no-inhibit-'));
  try {
    const env={...process.env,PATH:dir};delete env.ATTENDANCE_SLEEP_INHIBITED;
    const result=spawnSync(process.execPath,[cli,'--help'],{env,encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Attendance rehearsal/);
    assert.match(result.stderr,/sleep inhibition.*unavailable/i);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('directed cancellation reaches a forked runner and waits for its cleanup', {skip:process.platform!=='linux'},async()=>{
  for(const signal of ['SIGINT','SIGTERM']) {
    const dir=mkdtempSync(join(tmpdir(),'attendance-forked-inhibit-'));
    const pidFile=join(dir,'runner.pid'),stopped=join(dir,'stopped'),groupFile=join(dir,'group.pid');
    const worker=join(dir,'worker.mjs');
    writeFileSync(worker,`import {writeFileSync} from 'node:fs';
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>setTimeout(()=>{writeFileSync(process.env.STOPPED,signal);process.exit(0);},200));
writeFileSync(process.env.RUNNER_PID,String(process.pid));setInterval(()=>{},1000);`);
    writeFileSync(join(dir,'systemd-inhibit'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in --*) shift;; *) break;; esac; done\nif [ "$1" = /usr/bin/true ]; then exit 0; fi\ntrap "" INT\nprintf "%s" "$$" > "$GROUP_PID"\n"$REAL_NODE" "$LONG_WORKER" <&0 &\nwait "$!"\n',{mode:0o755});
    const env={...process.env,PATH:dir+':/usr/bin:/bin',REAL_NODE:process.execPath,LONG_WORKER:worker,RUNNER_PID:pidFile,STOPPED:stopped,GROUP_PID:groupFile};
    delete env.ATTENDANCE_SLEEP_INHIBITED;
    const child=spawn(process.execPath,[cli,'--help'],{env,detached:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const exited=new Promise((ok,fail)=>{child.once('error',fail);child.once('exit',code=>ok(code));});
    try {
      const until=Date.now()+15000;
      while(!existsSync(pidFile) && Date.now()<until)await delay(20);
      assert.equal(existsSync(pidFile),true,output);
      child.kill(signal);
      const code=await Promise.race([exited,delay(5000).then(()=>{throw new Error('Forked runner did not exit after directed cancellation');})]);
      assert.equal(code,0,output);
      assert.equal(readFileSync(stopped,'utf8'),'SIGINT');
      const pid=Number(readFileSync(pidFile,'utf8'));
      assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
    } finally {
      if(child.exitCode===null && !child.signalCode)try{process.kill(-child.pid,'SIGKILL');}catch{ /* exited */ }
      if(existsSync(pidFile)) {
        const pid=Number(readFileSync(pidFile,'utf8'));
        try {if(readFileSync(`/proc/${pid}/cmdline`).includes(Buffer.from(worker)))process.kill(pid,'SIGKILL');}catch{ /* exited */ }
      }
      if(existsSync(groupFile))try{process.kill(-Number(readFileSync(groupFile,'utf8')),'SIGKILL');}catch{ /* exited */ }
      rmSync(dir,{recursive:true,force:true});
    }
  }
});
