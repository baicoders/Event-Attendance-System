/** Run the existing export/print fixtures with an owned app, DB and Chrome. */
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync,openSync,closeSync,readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({databaseUrl,base})=>{
 const env={...process.env,DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl,EXPORT_TEST_BASE_URL:base,EXPORT_STRESS_PRINT:'1'};
 const api=spawnSync('node',['--conditions=react-server','--import','tsx','scripts/test-event-export.ts'],{env,encoding:'utf8',timeout:180000});assert.equal(api.status,0,api.stdout+'\n'+api.stderr);console.log(api.stdout);
 const listener=createServer();await new Promise((ok,fail)=>{listener.once('error',fail);listener.listen(0,'127.0.0.1',ok);});const port=listener.address().port;await new Promise(ok=>listener.close(ok));
 const profile='.superpowers/classroom-tests/export-'+randomUUID();mkdirSync(profile,{recursive:true});const chromeLog=profile+'/chrome.log';const fd=openSync(chromeLog,'w');const chrome=spawn(process.env.E2E_CHROME??'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2','--no-first-run','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+resolve(profile),'about:blank'],{detached:true,stdio:['ignore',fd,fd]});
 try{let ready=false;for(let i=0;i<300;i++){try{const response=await fetch('http://127.0.0.1:'+port+'/json/list');if(response.ok){ready=true;break;}}catch{}if(chrome.exitCode!==null)break;await delay(200);}assert.ok(ready,'Owned Chrome CDP did not start: '+readFileSync(chromeLog,'utf8').slice(-4000));const browser=spawnSync('node',['--conditions=react-server','--import','tsx','scripts/test-event-export-browser.ts'],{env:{...env,EXPORT_TEST_CDP_URL:'http://127.0.0.1:'+port},encoding:'utf8',timeout:180000});assert.equal(browser.status,0,browser.stdout+'\n'+browser.stderr);console.log(browser.stdout);}
 finally{try{process.kill(-chrome.pid,'SIGTERM');}catch{}await Promise.race([new Promise(ok=>chrome.once('exit',ok)),delay(3000)]);closeSync(fd);}
});
