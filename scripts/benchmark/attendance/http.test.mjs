import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { createClient } from './http.mjs';

test('HTTPS client verifies trust, sends login cookies, coalesces reads and never replays an uncertain write', async () => {
  const dir=mkdtempSync(join(tmpdir(),'attendance-http-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore'});
  let writes=0, reads=0;
  const server=createServer({key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},(req,res)=>{
    if(req.url==='/login') res.setHeader('set-cookie','test-session=owned; Secure; HttpOnly');
    if(req.url==='/write') { writes++; assert.equal(req.headers.cookie,'test-session=owned'); }
    if(req.url==='/read') reads++;
    setTimeout(()=>res.end(JSON.stringify({success:true,data:{ok:true}})),10);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`https://127.0.0.1:${server.address().port}`;
  const metrics=[];
  const client=createClient({base,ca:readFileSync(join(dir,'cert.pem')),onMetric:sample=>metrics.push(sample)});
  const untrusted=createClient({base});
  try {
    await assert.rejects(untrusted.call('/read'));
    await client.call('/login',{method:'POST',body:{}});
    await Promise.all([client.call('/read'),client.call('/read')]);
    assert.equal(reads,1);
    await assert.rejects(client.call('/write',{method:'POST',body:{},discardResponse:true}), error=>error.code==='RESULT_UNKNOWN');
    assert.equal(writes,1);
    assert.equal(metrics.at(-1).outcome,'RESULT_UNKNOWN');
    assert.ok(metrics.at(-1).bytes>0);
  } finally {
    client.close(); untrusted.close();
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
