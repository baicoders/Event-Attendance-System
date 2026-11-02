import { z } from 'zod';
import { commandIdSchema } from './commandId';
export const teacherApplicationSchema = z.object({
  commandId: commandIdSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
  action: z.enum(['SAVE', 'SUBMIT']),
  departmentOrDesignation: z.string().trim().min(1, 'Enter your teaching designation.').max(160),
  staffReference: z.string().trim().max(100).nullable().optional(),
  applicationText: z.string().trim().max(1000).default(''),
}).strict();
export const teacherDecisionSchema = z.object({
  commandId: commandIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  action: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REVOKE', 'RESTORE']),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(v => v.action === 'APPROVE' || !!v.reason, { message: 'A reason is required.', path: ['reason'] });
