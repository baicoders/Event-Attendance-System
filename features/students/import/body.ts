import { ImportError } from './errors';

export async function readImportBody(request: Request, limit = 10*1024*1024): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new ImportError('Request is too large (10 MiB maximum).', 'PAYLOAD_TOO_LARGE', 413);
  if (!request.body) throw new ImportError('JSON body required.', 'INVALID_REQUEST');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ImportError('Request is too large (10 MiB maximum).', 'PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw new ImportError('Invalid JSON request.', 'INVALID_REQUEST'); }
}
