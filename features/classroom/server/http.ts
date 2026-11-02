import 'server-only';
import { classroomAvailableFor } from './featureFlags';
import { NextResponse } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { takeSharedRateLimit } from '@/globals/server/requestRateLimit';
import { ok } from '@/globals/utils/api';
import { respondWithError } from '@/globals/utils/httpError';
import { AuthError, requireClassroomAccess, requireAdmin } from '@/globals/utils/auth';

export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
export function classroomJson<T>(data: T, status = 200) {
  return NextResponse.json(ok(data), { status, headers: PRIVATE_HEADERS });
}
export function classroomError(error: unknown) {
  const response = respondWithError(error);
  response.headers.set('Cache-Control', 'private, no-store');
  if(error instanceof AuthError&&error.status===429)response.headers.set('Retry-After',String(error.details?.retryAfterSeconds??60));
  return response;
}
export { readLimitedJson as readClassroomBody } from "@/globals/utils/requestBody";
export async function requireClassroomActor() {
  const user = await requireClassroomAccess();
  if (!classroomAvailableFor(user.id, user.role === 'ADMIN')) throw new AuthError('Classroom is not enabled for this account.', 403, 'CLASSROOM_NOT_ENABLED');
  return { userId: user.id, credentialVersion: user.credentialVersion };
}

export async function requireClassroomAdministrator(){
 const user=await requireAdmin();
 if(!classroomAvailableFor(user.id,true))throw new AuthError('Classroom is not enabled for this account.',403,'CLASSROOM_NOT_ENABLED');
 return {userId:user.id,credentialVersion:user.credentialVersion};
}

/** Separate shared abuse metadata; never includes student IDs or raw QR payloads. */
export async function classroomRequestLimit(db:PrismaClient,userId:string,kind:'scan'|'directory'){
 const allowed=await takeSharedRateLimit(db,'classroom:'+kind+':'+userId,kind==='scan'?600:240,60000);
 if(!allowed)throw new AuthError('Too many requests. Wait a moment before retrying.',429,'RATE_LIMITED',{retryAfterSeconds:60});
}
