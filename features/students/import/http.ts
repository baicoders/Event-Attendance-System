import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/globals/utils/auth';
import { err, ok } from '@/globals/utils/api';
import { ImportError } from './errors';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
export { readImportBody } from './body';
export function importSuccess<T>(data: T) { return NextResponse.json(ok(data), {headers: PRIVATE}); }
export function importFailure(error: unknown) {
  if (error instanceof AuthError || error instanceof ImportError) {
    return NextResponse.json({...err(error.message,error.code),outcome:'REJECTED'}, {status:error.status,headers:PRIVATE});
  }
  if (error instanceof ZodError) {
    return NextResponse.json({...err('Invalid canonical import request.','INVALID_REQUEST'),outcome:'REJECTED'}, {status:400,headers:PRIVATE});
  }
  // A commit acknowledgement can itself be lost. Unknown database/transport
  // errors never imply rollback, even when the HTTP response was delivered.
  console.error('STUDENT_IMPORT_ERROR', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json(err('Unable to establish the import outcome.','IMPORT_OUTCOME_UNKNOWN'), {status:503,headers:PRIVATE});
}
