import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writePrivateReport} from './setup-report';
test('partial report write preserves the previous valid commit evidence',t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'uswag-report-atomic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const path=join(dir,'report.json');
 writePrivateReport(path,{outcome:'commit-pending',id:'synthetic'});
 const original=fs.writeFileSync;
 const fault=t.mock.method(fs,'writeFileSync',(...args:Parameters<typeof fs.writeFileSync>)=>{original(args[0],'{"partial":');throw new Error('synthetic ENOSPC');});
 assert.throws(()=>writePrivateReport(path,{outcome:'committed'}),/ENOSPC/);fault.mock.restore();
 assert.deepEqual(JSON.parse(fs.readFileSync(path,'utf8')),{outcome:'commit-pending',id:'synthetic'});assert.deepEqual(fs.readdirSync(dir),['report.json']);assert.equal(fs.statSync(path).mode&0o777,0o600);
});
