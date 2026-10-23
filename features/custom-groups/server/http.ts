import { NextResponse } from 'next/server';
import { z } from 'zod';
import { err } from '@/globals/utils/api';
import { respondWithError } from '@/globals/utils/httpError';
import { CustomGroupError } from './membership';
export const customGroupNameSchema = z.object({name:z.string().trim().min(1).max(80)});
const position=z.string().trim().max(160).nullable().transform(value=>value || null);
export const addMemberSchema = z.object({studentId:z.string().min(1),position:position.optional()});
export const positionSchema = z.object({position});
export function customGroupFailure(error: unknown) {
  if (error instanceof CustomGroupError) return NextResponse.json(err(error.message,error.code),{status:error.status});
  return respondWithError(error);
}
export const customStudentSelect={id:true,firstName:true,middleName:true,lastName:true,usn:true,lrn:true} as const;
