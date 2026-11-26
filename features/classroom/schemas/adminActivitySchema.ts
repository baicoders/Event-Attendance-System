import { z } from 'zod';
import { entityId } from './rosterSchema';
export const activitySource=z.enum(['attendance','audit','profile','verification']);
export const adminActivitySchema=z.object({source:activitySource.optional(),actorId:entityId.optional(),classId:entityId.optional(),sessionId:entityId.optional(),studentId:entityId.optional(),entityId:entityId.optional(),action:z.string().trim().max(80).optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),cursor:z.string().max(512).optional(),pageSize:z.coerce.number().int().min(1).max(100).default(50),includeBaseline:z.enum(['true','false']).default('false').transform(v=>v==='true')}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,'Choose a valid date range.');
