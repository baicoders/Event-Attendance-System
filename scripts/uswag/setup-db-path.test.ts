import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFixture} from './setup-fixture.test-support';
import {executeSetup} from './setup-db';
test('rejects a report directory symlink into a repository before connecting',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'uswag-report-symlink-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const fixture=createFixture(join(dir,'input'));const repo=join(dir,'repo');mkdirSync(repo);mkdirSync(join(repo,'.git'));
 const nested=join(repo,'nested');mkdirSync(nested);
 const link=join(dir,'outside-link');symlinkSync(nested,link);
 await assert.rejects(()=>executeSetup({inputDir:fixture.inputDir,databaseUrl:'postgresql://u:p@127.0.0.1:1/postgres',report:join(link,'private.json')}),/REPORT_MUST_BE_OUTSIDE_REPOSITORY/);
});
