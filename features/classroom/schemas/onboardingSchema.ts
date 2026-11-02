import { z } from 'zod';
import { commandIdSchema } from './commandId';
import { entityId } from './rosterSchema';
import { scheduleSchema } from './classSchema';
// Only small class setup fields are persisted. No credentials, student records or attendance drafts.
export const firstClassDraftSchema = z.object({
  displayName:z.string().max(160).optional(), termId:entityId.optional(), subjectId:entityId.optional(),
  sectionIds:z.array(entityId).max(100).optional(), graceMinutes:z.number().int().min(0).max(180).optional(),
  schedule:scheduleSchema.nullable().optional(),
}).strict();
export const onboardingSchema = z.object({
  commandId:commandIdSchema, expectedRevision:z.number().int().nonnegative(),
  step:z.enum(['WELCOME','CLASS','ROSTER','SETTINGS','TUTORIAL','READY','DRAFT']),
  classId:entityId.nullable().optional(),
  draft:z.object({classForm:firstClassDraftSchema.optional(),tutorial:z.enum(['SEEN','SKIPPED']).optional()}).strict().optional(),
  expectedRosterRevision:z.number().int().nonnegative().optional(),
  expectedConfigRevision:z.number().int().nonnegative().optional(),
  rosterFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  complete:z.boolean().optional(),
}).strict().refine(value=>!value.complete||value.step==='READY','Finish setup from the Ready step.');
export const savedOnboardingDraftSchema = z.object({
  welcomeSeen:z.boolean().optional(), classForm:firstClassDraftSchema.optional(),
  reviewedRoster:z.object({classId:entityId,rosterRevision:z.number().int().nonnegative(),rosterFingerprint:z.string()}).optional(),
  reviewedSettings:z.object({classId:entityId,configRevision:z.number().int().nonnegative()}).optional(),
  tutorial:z.enum(['SEEN','SKIPPED']).optional(),
}).refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=16*1024,'Saved setup must fit within 16 KiB.');
export type FirstClassDraft = z.infer<typeof firstClassDraftSchema>;
export type SavedOnboardingDraft = z.infer<typeof savedOnboardingDraftSchema>;
