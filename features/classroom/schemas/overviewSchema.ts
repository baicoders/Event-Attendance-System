import { z } from 'zod';
import { entityId } from './rosterSchema';
export const overviewQuerySchema=z.object({termId:entityId.optional()}).strict();
export const overviewClassSnapshotSchema=z.object({v:z.literal(1),id:z.string(),displayName:z.string(),primaryTeacher:z.object({id:z.string(),name:z.string()}),term:z.object({id:z.string(),name:z.string()}),subject:z.object({id:z.string(),code:z.string().nullable().default(null),title:z.string()}),sections:z.array(z.object({sectionId:z.string(),name:z.string(),slug:z.string()}))});
