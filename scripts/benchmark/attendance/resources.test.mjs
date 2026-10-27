import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeResources } from './resources.mjs';

test('resource summary derives busy CPU from counter deltas and keeps unavailable RSS unknown',()=>{
  const samples=[
    {host:{cpuTicks:{idle:100,total:200},availableBytes:4096,swapUsedBytes:0},generator:{rssBytes:1000},processes:{app:{rssBytes:2000},caddy:null}},
    {host:{cpuTicks:{idle:700,total:1200},availableBytes:2048,swapUsedBytes:1024},generator:{rssBytes:1500},processes:{app:{rssBytes:3000},caddy:null}},
  ];
  const summary=summarizeResources(samples);
  assert.equal(summary.averageHostBusyPercent,40);
  assert.equal(summary.maxHostBusyPercent,40);
  assert.equal(summary.minAvailableBytes,2048);
  assert.equal(summary.maxSwapUsedBytes,1024);
  assert.equal(summary.peakGeneratorRssBytes,1500);
  assert.equal(summary.peakAppRssBytes,3000);
  assert.equal(summary.peakCaddyRssBytes,null);
});
