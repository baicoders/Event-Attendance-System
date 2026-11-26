import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError,fetchApi } from './api';
test('unreadable or contradictory responses never certify a rejected mutation',async(t)=>{
 for(const response of [new Response('gateway',{status:409}),Response.json({},{status:200}),Response.json({success:true,data:{saved:true}},{status:409})]){
  t.mock.method(globalThis,'fetch',async()=>response);
  await assert.rejects(fetchApi('/example'),(error:unknown)=>{assert.ok(error instanceof ApiError);assert.equal(error.hasValidResponse,false);return true;});t.mock.restoreAll();
 }
});
test('a valid application rejection and successful data remain distinguishable',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:false,message:'Rate limited.',code:'RATE_LIMITED'},{status:429}));
 await assert.rejects(fetchApi('/example'),(error:unknown)=>{assert.ok(error instanceof ApiError);assert.equal(error.hasValidResponse,true);assert.equal(error.code,'RATE_LIMITED');return true;});t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'confirmed'}}));assert.deepEqual(await fetchApi('/example'),{id:'confirmed'});
});
