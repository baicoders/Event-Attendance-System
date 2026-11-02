import 'server-only';
import { classroomAvailableFor } from './featureFlags';
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
export { readLimitedJson as readClassroomBody } from "@/globals/utils/requestBody";
export async function requireClassroomActor() {
  const user = await requireClassroomAccess();
  if (!classroomAvailableFor(user.id, user.role === 'ADMIN')) throw new AuthError('Classroom is not enabled for this account.', 403, 'CLASSROOM_NOT_ENABLED');
  return { userId: user.id, credentialVersion: user.credentialVersion };
}
