import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as reset from './reset';

test('verifies Docker forwarded endpoint from the socket while permitting internal server address',()=>{
 assert.equal(typeof reset.assertResetConnection,'function');
 const target={database:'test_uswag_forwarded',port:5433};
 const actual={database:'test_uswag_forwarded',template:false,address:'172.18.0.2',port:5432};
 assert.doesNotThrow(()=>reset.assertResetConnection(target,actual,{remoteAddress:'127.0.0.1',remotePort:5433}));
 for(const peer of [{remoteAddress:'172.18.0.2',remotePort:5433},{remoteAddress:'127.0.0.1',remotePort:5432},{}]){
  assert.throws(()=>reset.assertResetConnection(target,actual,peer),/USWAG_RESET_CONNECTED_TARGET_REFUSED/);
 }
 for(const database of [{...actual,template:true},{...actual,database:'postgres'},undefined]){
  assert.throws(()=>reset.assertResetConnection(target,database,{remoteAddress:'127.0.0.1',remotePort:5433}),/USWAG_RESET_CONNECTED_TARGET_REFUSED/);
 }
});

// Removing target restrictions must make these tests fail before any connection.
test('allows only approved development and disposable loopback reset targets',()=>{
 assert.equal(typeof reset.validateResetTarget,'function');
 for(const host of ['localhost','127.0.0.1','[::1]']){
  const target=reset.validateResetTarget(`postgresql://user:secret@${host}:5433/event_attendance_dev?connect_timeout=5`);
  assert.equal(target.database,'event_attendance_dev');assert.equal(target.port,5433);
 }
 assert.equal(reset.validateResetTarget('postgres://user:secret@127.0.0.1/test_uswag_reset_123').database,'test_uswag_reset_123');
});

test('refuses URL options that the subsequent approved setup cannot consume',()=>{
 for(const query of ['schema=public','connection_limit=2','pool_timeout=10']){
  assert.throws(()=>reset.validateResetTarget(`postgresql://user:secret@localhost/event_attendance_dev?${query}`),
   error=>error instanceof Error&&error.message==='USWAG_RESET_TARGET_REFUSED');
 }
});

test('CLI rejects manual flags before loading config or touching a database',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','scripts/uswag/reset.ts','--force'],{
  cwd:process.cwd(),env:{...process.env,USWAG_SETUP_CONFIG:'/missing/private/config.json',DATABASE_URL:'postgresql://user:secret@remote.invalid/production'},encoding:'utf8',
 });
 assert.equal(result.status,1);assert.equal(result.stdout,'');
 assert.equal(result.stderr.trim(),'USWAG_RESET_ACCEPTS_NO_OPTIONS');
});

test('refuses remote, maintenance, template and redirected targets without exposing credentials',()=>{
 assert.equal(typeof reset.validateResetTarget,'function');
 const invalid=[
  'postgresql://user:secret@db.example.com/event_attendance_dev',
  'postgresql://user:secret@localhost.example.com/event_attendance_dev',
  ...['postgres','template0','template1','production','event_attendance_dev_other','test_uswag_'].map(db=>`postgresql://user:secret@localhost/${db}`),
  ...['host=db.example.com','host=127.0.0.1','database=production','dbname=production','port=5434','schema=private','options=-csearch_path=private','schema=public&schema=private','service=production'].map(query=>`postgresql://user:secret@localhost/event_attendance_dev?${query}`),
  'postgresql://user:secret@localhost/event_attendance_dev/other',
  'postgresql://user:secret@localhost/event_attendance_dev#ignored',
  'postgresql://user:secret@localhost/%74est_uswag_encoded',
  'file:secret',
 ];
 for(const url of invalid)assert.throws(()=>reset.validateResetTarget(url),error=>error instanceof Error&&error.message==='USWAG_RESET_TARGET_REFUSED');
});
