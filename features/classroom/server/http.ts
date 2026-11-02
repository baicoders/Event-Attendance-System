import 'server-only';
import { NextResponse } from 'next/server';
import { ok } from '@/globals/utils/api';
import { respondWithError } from '@/globals/utils/httpError';
import { AuthError, requireClassroomAccess } from '@/globals/utils/auth';

export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
export function classroomJson<T>(data: T, status = 200) {
  return NextResponse.json(ok(data), { status, headers: PRIVATE_HEADERS });
}
export function classroomError(error: unknown) {
  const response = respondWithError(error);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export async function readClassroomBody(req: Request, limit = 65536): Promise<unknown> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('JSON request required.', 400, 'INVALID_REQUEST');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw new AuthError('Request is too large.', 413, 'PAYLOAD_TOO_LARGE');
  try { return JSON.parse(text); } catch { throw new AuthError('Invalid JSON request.', 400, 'INVALID_REQUEST'); }
}
export async function requireClassroomActor() {
  const user = await requireClassroomAccess();
  const pilot = process.env.CLASSROOM_PILOT_USER_IDS?.split(',').map(v => v.trim()).filter(Boolean) ?? [];
  if (process.env.CLASSROOM_ENABLED !== 'true' || (pilot.length && !pilot.includes(user.id) && user.role !== 'ADMIN')) throw new AuthError('Classroom is not enabled for this account.', 403, 'CLASSROOM_NOT_ENABLED');
  return { userId: user.id, credentialVersion: user.credentialVersion };
}
