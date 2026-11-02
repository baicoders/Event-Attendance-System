import { AuthError } from './authError';
/** Bound bytes while streaming, not after allocating an arbitrarily large body. */
export async function readLimitedJson(req: Request, limit = 65536): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError('JSON request required.', 400, 'INVALID_REQUEST');
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new AuthError('Request is too large.', 413, 'PAYLOAD_TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) throw new AuthError('JSON body required.', 400, 'INVALID_REQUEST');
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw new AuthError('Request is too large.', 413, 'PAYLOAD_TOO_LARGE'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid JSON request.', 400, 'INVALID_REQUEST');
  } finally { reader.releaseLock(); }
}
