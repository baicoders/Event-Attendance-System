import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportSource } from './parseSource';

test('source parsing preserves exact UTF-8 and reports canonical CSV row issues', async () => {
  const csv = '\uFEFFusn,firstName,lastName\r\n00000123456,Synthetic,Student\r\n';
  const result = await parseImportSource('synthetic.csv', new TextEncoder().encode(csv).buffer);
  assert.equal(result.csv, csv);
  assert.equal(result.rowCount, 1);
  assert.equal(result.structurallyValid, true);
  assert.equal(result.sourceHash, Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv))).toString('hex'));
  assert.equal((await parseImportSource('bad.csv', new TextEncoder().encode('name\nStudent').buffer)).structurallyValid, false);
});

test('source parsing rejects unsupported files and malformed UTF-8', async () => {
  await assert.rejects(parseImportSource('synthetic.exe', new ArrayBuffer(0)), /CSV or XLSX/);
  await assert.rejects(parseImportSource('synthetic.csv', new Uint8Array([0xff]).buffer));
});
