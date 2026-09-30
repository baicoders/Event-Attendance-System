import test from 'node:test';
import assert from 'node:assert/strict';
import * as locks from './pgLocks';

test('import commands are actor-scoped and isolated from attendance commands', async () => {
  const command = 'bd999005-a1a6-473b-8f30-c02a1e0d6a6f';
  assert.equal(typeof locks.importCommandKey, 'function');
  assert.equal(locks.importCommandKey('admin-a', command), locks.importCommandKey('admin-a', command));
  assert.notEqual(locks.importCommandKey('admin-a', command), locks.importCommandKey('admin-b', command));
  assert.notEqual(locks.importCommandKey('admin-a', command), locks.commandKey(command));
  const observed: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { observed.push({sql:sql.join('?'),values}); return 0; },
  };
  await locks.takeImportCommandLock(tx, 'admin-a', command);
  assert.deepEqual(observed, [{sql:'SELECT pg_advisory_xact_lock(?)',values:[locks.importCommandKey('admin-a',command)]}]);
});
