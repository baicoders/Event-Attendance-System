import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getServerSecret } from '@/globals/utils/serverSecret';
import { ImportError } from './errors';

export const IMPORT_TOKEN_PURPOSE = 'student-import-review-v1';
export const IMPORT_TOKEN_TTL_MS = 10 * 60 * 1000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const tokenSchema = z.object({
  v: z.literal(1), purpose: z.literal(IMPORT_TOKEN_PURPOSE), actorId: z.string().min(1),
  fileName: z.string().min(1).max(200), sourceHash: digest, normalizedInputHash: digest,
  reviewHash: digest, preparedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).strict();
export type ImportToken = z.infer<typeof tokenSchema>;
function sign(body: string) {
  return createHmac('sha256', getServerSecret()).update(`${IMPORT_TOKEN_PURPOSE}.${body}`).digest('base64url');
}
export function signImportToken(payload: ImportToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function assertImportTokenFresh(payload: ImportToken) {
  if (payload.expiresAt <= Date.now()) throw new ImportError('This review expired. Review the file again.', 'PREVIEW_EXPIRED', 409);
}
export function verifyImportToken(token: string, actorId: string, allowExpired = false): ImportToken {
  const parts = token.split('.');
  const fail = () => new ImportError('Invalid or stale import review. Review again.', 'STALE_PREVIEW', 409);
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) throw fail();
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw fail();
  let payload: ImportToken;
  try { payload = tokenSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))); }
  catch { throw fail(); }
  if (payload.actorId !== actorId || payload.expiresAt <= payload.preparedAt || payload.expiresAt - payload.preparedAt > IMPORT_TOKEN_TTL_MS || payload.preparedAt > Date.now()+1000) throw fail();
  if (!allowExpired) assertImportTokenFresh(payload);
  return payload;
}
