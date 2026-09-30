import test from 'node:test';
import assert from 'node:assert/strict';
import { hashImportCommand } from './commandHash';

test('command hash binds actor, UUID, exact review identity and canonical input/source metadata', () => {
  const command = {v:1 as const,commandId:'bd999005-a1a6-473b-8f30-c02a1e0d6a6f',previewToken:'signed.review',fileName:'master.csv',sourceHash:'a'.repeat(64),csv:'source'};
  const prepared = {sourceHash:'a'.repeat(64),normalizedInputHash:'b'.repeat(64)};
  const hash = hashImportCommand(command,'admin',prepared);
  assert.equal(hash,hashImportCommand({...command,sourceHash:command.sourceHash.toUpperCase()},'admin',prepared));
  assert.notEqual(hash,hashImportCommand(command,'other',prepared));
  for (const change of [{commandId:'cd999005-a1a6-473b-8f30-c02a1e0d6a6f'},{previewToken:'another.review'},{fileName:'other.csv'}]) {
    assert.notEqual(hash,hashImportCommand({...command,...change},'admin',prepared));
  }
  assert.notEqual(hash,hashImportCommand(command,'admin',{...prepared,sourceHash:'c'.repeat(64)}));
  assert.notEqual(hash,hashImportCommand(command,'admin',{...prepared,normalizedInputHash:'c'.repeat(64)}));
});
