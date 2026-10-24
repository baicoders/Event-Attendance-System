import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, commitRequestSchema, importCountsSchema, importRequestSchema, type ImportCounts } from './contract';

export type ImportProgress = { type: 'progress'; processed: number; total: number; batch: number; batches: number };
export type PendingImportReference = { commandId: string; sourceHash: string; fileName: string; counts: ImportCounts };
const MAX_FRAME_BYTES = MAX_IMPORT_BYTES + 65_536;
const MAX_STREAM_BYTES = MAX_IMPORT_BYTES + 1024 * 1024;
const MAX_REFERENCE_CHARS = 8192;

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** Progress is tentative transaction work. Only the caller's validated receipt proves commit. */
export async function readImportProgressStream(body: ReadableStream<Uint8Array>, total: number, onProgress: (event: ImportProgress) => void): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', bytes = 0, events = 0;
  let last: ImportProgress | null = null;
  let hasResult = false;
  let envelope: unknown;
  const consume = (line: string) => {
    if (!line.trim()) return;
    if (hasResult || line.length > MAX_FRAME_BYTES) throw new Error('Invalid import response stream.');
    const event: unknown = JSON.parse(line);
    if (!record(event)) throw new Error('Invalid import response frame.');
    if (event.type === 'result' && exactKeys(event, ['type', 'envelope'])) {
      hasResult = true;
      envelope = event.envelope;
      return;
    }
    if (!exactKeys(event, ['type', 'processed', 'total', 'batch', 'batches']) || event.type !== 'progress' ||
      !integer(event.processed) || !integer(event.total) || !integer(event.batch) || !integer(event.batches) ||
      event.total !== total || event.processed > total || event.batch > event.batches ||
      event.batches > MAX_IMPORT_ROWS || ++events > MAX_IMPORT_ROWS + 2 ||
      (last && (event.processed < last.processed || event.batch < last.batch || event.batches !== last.batches))) {
      throw new Error('Invalid import progress.');
    }
    last = event as ImportProgress;
    onProgress(last);
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw new Error('Import response exceeds its byte limit.');
      pending += decoder.decode(next.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > MAX_FRAME_BYTES) throw new Error('Import response frame exceeds its byte limit.');
    }
    pending += decoder.decode();
    if (pending.length || !hasResult) throw new Error('Import response was interrupted before a complete result.');
    return envelope;
  } finally {
    // Cancelling observation must never be interpreted as cancelling the transaction.
    try { await reader.cancel(); } catch { /* Preserve the original observation failure. */ }
    reader.releaseLock();
  }
}

export const pendingImportStorageKey = (actorId: string, credentialVersion: number) => `student-import-pending:${encodeURIComponent(actorId)}:${credentialVersion}`;

/** Deliberately select metadata: the source CSV, preview token and frozen body stay in memory. */
export function serializePendingImportReference<T extends PendingImportReference>(command: T, actorId: string, credentialVersion: number): string {
  return JSON.stringify({ v: 1, actorId, credentialVersion, commandId: command.commandId, fileName: command.fileName, sourceHash: command.sourceHash, counts: command.counts });
}

export function parsePendingImportReference(raw: string | null, actorId: string, credentialVersion: number): PendingImportReference | null {
  if (!raw || raw.length > MAX_REFERENCE_CHARS) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !exactKeys(value, ['v', 'actorId', 'credentialVersion', 'commandId', 'fileName', 'sourceHash', 'counts']) ||
      value.v !== 1 || value.actorId !== actorId || value.credentialVersion !== credentialVersion) return null;
    const commandId = commitRequestSchema.shape.commandId.safeParse(value.commandId);
    const fileName = importRequestSchema.shape.fileName.safeParse(value.fileName);
    const sourceHash = importRequestSchema.shape.sourceHash.safeParse(value.sourceHash);
    const counts = importCountsSchema.safeParse(value.counts);
    if (!commandId.success || !fileName.success || !sourceHash.success || !counts.success || counts.data.blocked !== 0 ||
      counts.data.total === 0 || counts.data.total > MAX_IMPORT_ROWS ||
      counts.data.total !== counts.data.create + counts.data.update + counts.data.unchanged) return null;
    return { commandId: commandId.data, fileName: fileName.data, sourceHash: sourceHash.data.toLowerCase(), counts: counts.data };
  } catch { return null; }
}
