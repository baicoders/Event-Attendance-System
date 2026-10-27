import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('phone rehearsal refuses an occupied upstream before contacting PostgreSQL and leaves that listener alive',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'attendance-phone-guard-'));
  const listener=createServer(socket=>socket.end('still alive'));
  let owned=true;
  await new Promise((ok,fail)=>{
    listener.once('error',error=>{if(error.code==='EADDRINUSE'){owned=false;ok();}else fail(error);});
    listener.listen(3000,'127.0.0.1',ok);
  });
  try {
    const script=fileURLToPath(new URL('./run.mjs',import.meta.url));
    // Deliberately unusable credentials: port safety must run before any DB provisioning.
    const child=spawn(process.execPath,['--import',fileURLToPath(import.meta.resolve('tsx')) ,script,'--phones','--label','guard'],{
      cwd:dir,env:{...process.env,TEST_DATABASE_URL:'postgresql://invalid:invalid@127.0.0.1:1/postgres'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('exit',ok);});
    assert.equal(code,1,output);
    assert.match(output,/EADDRINUSE|address already in use/);
    if(owned)assert.equal(listener.listening,true);
    const root=join(dir,'test-results','attendance-load');
    const report=JSON.parse(readFileSync(join(root,readdirSync(root)[0],'report.json'),'utf8'));
    assert.equal(report.completed,false);
    assert.equal(report.cleanedUp,true);
    assert.equal(report.verdict.passed,false);
  } finally {
    if(owned)await new Promise(ok=>listener.close(ok));
    rmSync(dir,{recursive:true,force:true});
  }
});
