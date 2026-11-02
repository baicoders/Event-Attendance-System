import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { takeSharedRateLimit } from '@/globals/server/requestRateLimit';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
before(async () => { fixture = await createDisposableDb(); client = createTestClient(fixture.url); });
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('one shared bucket admits exactly the limit under concurrent connections', async () => {
  const results = await Promise.all(Array.from({ length: 9 }, () => takeSharedRateLimit(client.db, 'login:test-user', 3, 60000)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await takeSharedRateLimit(client.db, 'login:other-user', 3, 60000), true);
  await client.db.requestRateLimit.updateMany({ data: { resetAt: new Date(0) } });
  assert.equal(await takeSharedRateLimit(client.db, 'login:test-user', 3, 60000), true);
});
