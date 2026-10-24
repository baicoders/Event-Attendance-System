import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMPORT_BYTES } from './contract';
import { readImportProgressStream, serializePendingImportReference, parsePendingImportReference, pendingImportStorageKey } from './progressContract';

const stream = (...parts: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
const progress = (processed: number, batch = 1) => JSON.stringify({ type: 'progress', processed, total: 100, batch, batches: 2 }) + '\n';
const envelope = { success: true, data: { receipt: 'validated by caller' } };
const result = JSON.stringify({ type: 'result', envelope }) + '\n';

test('stream parser handles split frames and only returns the terminal result envelope', async () => {
  const observed: number[] = [];
  const first = progress(50);
  const output = await readImportProgressStream(stream(first.slice(0, 15), first.slice(15), progress(100, 2), result), 100, event => observed.push(event.processed));
  assert.deepEqual(observed, [50, 100]);
  assert.deepEqual(output, envelope);
});

test('replayed result needs no progress and CRLF frames are accepted', async () => {
  assert.deepEqual(await readImportProgressStream(stream(result.replace('\n', '\r\n')), 100, () => assert.fail()), envelope);
});

test('progress is untrusted: totals, ranges, counters, fields and completion ordering are checked', async () => {
  for (const bad of [
    { type: 'progress', processed: 101, total: 100, batch: 1, batches: 2 },
    { type: 'progress', processed: 50, total: 99, batch: 1, batches: 2 },
    { type: 'progress', processed: 50.1, total: 100, batch: 1, batches: 2 },
    { type: 'progress', processed: 50, total: 100, batch: 3, batches: 2 },
    { type: 'progress', processed: -1, total: 100, batch: 1, batches: 2 },
    { type: 'progress', processed: 50, total: 100, batch: 1, batches: 2, student: 'private' },
  ]) await assert.rejects(readImportProgressStream(stream(JSON.stringify(bad) + '\n', result), 100, () => {}));
  await assert.rejects(readImportProgressStream(stream(progress(75), progress(50), result), 100, () => {}));
  await assert.rejects(readImportProgressStream(stream(progress(50), progress(75, 0), result), 100, () => {}));
  await assert.rejects(readImportProgressStream(stream(result, progress(100, 2)), 100, () => {}));
  await assert.rejects(readImportProgressStream(stream(result, result), 100, () => {}));
});

test('malformed, truncated or oversized streams cannot establish a committed outcome', async () => {
  for (const parts of [[progress(50)], ['{bad}\n'], [result.trimEnd()], ['x'.repeat(MAX_IMPORT_BYTES + 65537)]]) {
    await assert.rejects(readImportProgressStream(stream(...parts), 100, () => {}));
  }
});

const reference = { commandId: '00000000-0000-4000-8000-000000000000', fileName: 'synthetic.csv', sourceHash: 'a'.repeat(64), counts: { total: 100, create: 50, update: 25, unchanged: 25, blocked: 0 } };
test('refresh recovery retains only bounded reference metadata, never the source, token or body', () => {
  const serialized = serializePendingImportReference({ ...reference, body: 'secret CSV/token' }, 'admin', 2);
  assert.ok(!serialized.includes('secret'));
  const restored = parsePendingImportReference(serialized, 'admin', 2);
  assert.deepEqual(restored, reference);
  assert.equal(parsePendingImportReference(serialized, 'another-admin', 2), null);
  assert.equal(parsePendingImportReference(serialized, 'admin', 3), null);
  assert.notEqual(pendingImportStorageKey('admin', 2), pendingImportStorageKey('admin', 3));
});

test('corrupted or expanded reference metadata is rejected before UI recovery', () => {
  const serialized = serializePendingImportReference(reference, 'admin', 2);
  assert.equal(parsePendingImportReference('not json', 'admin', 2), null);
  assert.equal(parsePendingImportReference('x'.repeat(8193), 'admin', 2), null);
  const parsed = JSON.parse(serialized);
  for (const extra of [{ ...parsed, csv: 'secret' }, { ...parsed, commandId: '../wrong' }, { ...parsed, counts: { ...reference.counts, total: 101 } }, { ...parsed, sourceHash: 'bad' }]) {
    assert.equal(parsePendingImportReference(JSON.stringify(extra), 'admin', 2), null);
  }
});
