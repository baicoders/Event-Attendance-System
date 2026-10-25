import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const invoke=(args:string[])=>spawnSync(process.execPath,['--import','tsx','scripts/uswag/setup.ts',...args],{encoding:'utf8',env:{...process.env,DATABASE_URL:'postgresql://private-secret@remote.example/prod'}});
test('requires explicit target selection and never leaks implicit URL',()=>{
 const result=invoke([]);assert.notEqual(result.status,0);assert.match(result.stderr,/INVALID_OPTIONS/);assert.doesNotMatch(result.stderr,/private-secret|remote.example/);
});
test('apply without reviewed report and backup acknowledgement fails before inputs or connection',()=>{
 const result=invoke(['--input-dir','/missing','--database-url','postgresql://u:p@127.0.0.1/postgres','--apply']);
 assert.notEqual(result.status,0);assert.match(result.stderr,/APPLY_REQUIRES_REVIEW_AND_BACKUP/);
});
test('help exposes one command for all stages',()=>{
 const result=invoke(['--help']);assert.equal(result.status,0);assert.match(result.stdout,/uswag:setup/);assert.match(result.stdout,/--apply/);
});
